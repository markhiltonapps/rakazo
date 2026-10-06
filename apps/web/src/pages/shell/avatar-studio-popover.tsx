import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { AvatarGallery } from "@rakazo/contracts";
import { ATTACHMENT_MAX_BYTES, AVATAR_GALLERY_MAX_ITEMS } from "@rakazo/contracts";
import {
  BotAvatar,
  DEFAULT_GROK_BOT_COLOR,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  GROK_BOT_COLORS,
  GrokShapePreview,
  parseBotAvatar,
  Spinner,
} from "@rakazo/ui-web";
import { Check, Pencil, Plus, Upload, X } from "lucide-react";
import { type ClipboardEvent, type DragEvent, useEffect, useRef, useState } from "react";
import { readFileAsBase64 } from "../../lib/pending-attachments";
import { rpc } from "../../lib/rpc";

/** The server keeps these animated when the result fits an avatar. */
const ANIMATABLE_IMAGE_TYPES = new Set(["image/gif", "image/webp"]);

export interface AvatarStudioPopoverProps {
  value: string;
  identity?: string;
  status?: string;
  size?: number;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function AvatarStudioPopover({
  value,
  identity,
  status,
  size = 72,
  onChange,
  disabled = false,
}: AvatarStudioPopoverProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"bot" | "upload">("bot");
  const [dragOver, setDragOver] = useState(false);
  const [encoding, setEncoding] = useState(false);
  const [gallery, setGallery] = useState<AvatarGallery | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parsed = parseBotAvatar(value, identity);
  const currentColor = parsed.color || DEFAULT_GROK_BOT_COLOR;
  const currentShape = parsed.shapeIndex ?? 0;
  const canAddToGallery =
    gallery?.canManage === true &&
    parsed.isImage &&
    gallery.items.length < AVATAR_GALLERY_MAX_ITEMS &&
    !gallery.items.some((item) => item.value === value);
  const showGallery = Boolean(gallery?.items.length) || canAddToGallery;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    rpc.avatarGallery
      .list()
      .then((next) => {
        if (!cancelled) setGallery(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function addToGallery() {
    const item = await rpc.avatarGallery.add({ value }).catch(() => null);
    if (!item) return;
    setGallery((current) =>
      current
        ? { ...current, items: [...current.items.filter(({ id }) => id !== item.id), item] }
        : current,
    );
  }

  async function removeFromGallery(id: string) {
    setGallery((current) =>
      current ? { ...current, items: current.items.filter((item) => item.id !== id) } : current,
    );
    await rpc.avatarGallery.remove({ id }).catch(async () => {
      setGallery(await rpc.avatarGallery.list().catch(() => null));
    });
  }

  function selectShape(shapeIndex: number) {
    onChange(`${currentColor}::shape_${shapeIndex}`);
  }

  function selectColor(color: string) {
    onChange(`${color}::shape_${currentShape}`);
  }

  function resetAvatar() {
    onChange(`${DEFAULT_GROK_BOT_COLOR}::shape_0`);
  }

  function processImageFile(file: File) {
    if (!file.type.startsWith("image/") || encoding) return;
    if (ANIMATABLE_IMAGE_TYPES.has(file.type) && file.size <= ATTACHMENT_MAX_BYTES) {
      void encodeOnServer(file);
      return;
    }
    drawStillAvatar(file);
  }

  async function encodeOnServer(file: File) {
    setEncoding(true);
    try {
      const { color } = await rpc.bots.encodeAvatar({
        contentBase64: await readFileAsBase64(file),
      });
      onChange(color);
      setOpen(false);
    } catch {
      drawStillAvatar(file);
    } finally {
      setEncoding(false);
    }
  }

  function drawStillAvatar(file: File) {
    const reader = new FileReader();
    reader.onload = (event) => {
      const src = event.target?.result as string;
      if (!src) return;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const targetSize = 256;
        canvas.width = targetSize;
        canvas.height = targetSize;
        if (!ctx) return;

        ctx.beginPath();
        ctx.arc(targetSize / 2, targetSize / 2, targetSize / 2, 0, Math.PI * 2);
        ctx.clip();

        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, targetSize, targetSize);

        onChange(canvas.toDataURL("image/webp", 0.9));
        setOpen(false);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) processImageFile(file);
  }

  function handlePaste(event: ClipboardEvent<HTMLButtonElement>) {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item?.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (file) {
        processImageFile(file);
        break;
      }
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="group relative cursor-pointer rounded-2xl outline-none transition-transform hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t`Customize bot avatar`}
        data-testid="avatar-studio-trigger"
      >
        <BotAvatar color={value} identity={identity} size={size} status={status} />
        <div className="absolute -right-1 -bottom-1 flex size-6 items-center justify-center rounded-full border-2 border-background bg-secondary text-foreground shadow-md transition-transform group-hover:scale-110">
          <Pencil size={12} strokeWidth={2.2} />
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="w-[360px] max-w-full gap-4 rounded-3xl p-5 sm:max-w-[360px]"
          data-testid="avatar-studio"
        >
          <DialogHeader className="flex-row items-center justify-between space-y-0">
            <DialogTitle className="text-[14px] font-semibold tracking-tight">
              <Trans>Avatar Studio</Trans>
            </DialogTitle>
            <DialogDescription className="sr-only">
              <Trans>Choose a bot shape, color, or upload an image</Trans>
            </DialogDescription>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t`Close`}
            >
              <X size={16} />
            </button>
          </DialogHeader>

          <div className="flex flex-col items-center justify-center py-2">
            <BotAvatar color={value} identity={identity} size={78} status={status} />
          </div>

          <div className="flex items-center justify-between border-b border-border pb-1">
            <div className="flex items-center rounded-full bg-muted p-1 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab("bot")}
                aria-pressed={activeTab === "bot"}
                className={`rounded-full px-3 py-1 font-medium transition-colors ${
                  activeTab === "bot"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Trans>Bot</Trans>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("upload")}
                aria-pressed={activeTab === "upload"}
                className={`rounded-full px-3 py-1 font-medium transition-colors ${
                  activeTab === "upload"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Trans>Upload</Trans>
              </button>
            </div>

            <button
              type="button"
              onClick={resetAvatar}
              className="px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Trans>Reset</Trans>
            </button>
          </div>

          {activeTab === "bot" ? (
            <div className="space-y-4 pt-1" data-testid="avatar-studio-bot-tab">
              {gallery && showGallery ? (
                <div data-testid="avatar-gallery">
                  <div className="mb-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                    <Trans>Gallery</Trans>
                  </div>
                  <div className="grid grid-cols-4 place-items-center gap-2">
                    {gallery.items.map((item, index) => {
                      const position = index + 1;
                      const selected = item.value === value;
                      return (
                        <div key={item.id} className="group/gallery relative">
                          <button
                            type="button"
                            onClick={() => onChange(item.value)}
                            aria-label={t`Gallery avatar ${position}`}
                            aria-pressed={selected}
                            className={`block size-10 overflow-hidden rounded-full transition-transform hover:scale-110 active:scale-95 focus-visible:ring-2 focus-visible:ring-ring ${
                              selected
                                ? "ring-2 ring-foreground ring-offset-2 ring-offset-popover"
                                : ""
                            }`}
                          >
                            <img src={item.value} alt="" className="size-full object-cover" />
                          </button>
                          {gallery.canManage ? (
                            <button
                              type="button"
                              onClick={() => void removeFromGallery(item.id)}
                              aria-label={t`Remove from gallery`}
                              className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-secondary text-foreground opacity-0 shadow-sm transition-opacity group-hover/gallery:opacity-100 focus-visible:opacity-100"
                            >
                              <X size={10} />
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                    {canAddToGallery ? (
                      <button
                        type="button"
                        onClick={() => void addToGallery()}
                        aria-label={t`Add this avatar to the gallery`}
                        className="grid size-10 place-items-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Plus size={16} />
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className={showGallery ? "border-t border-border pt-2" : undefined}>
                <div className="mb-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                  <Trans>Shape</Trans>
                </div>
                <div className="grid grid-cols-4 place-items-center gap-2">
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((shapeIndex) => (
                    <GrokShapePreview
                      key={shapeIndex}
                      shapeIndex={shapeIndex}
                      color={currentColor}
                      selected={!parsed.isImage && currentShape === shapeIndex}
                      onClick={() => selectShape(shapeIndex)}
                    />
                  ))}
                </div>
              </div>

              <div className="border-t border-border pt-2">
                <div className="mb-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                  <Trans>Color</Trans>
                </div>
                <div className="grid grid-cols-6 place-items-center gap-2">
                  {GROK_BOT_COLORS.map((color) => {
                    const selected =
                      currentColor.toLowerCase() === color.toLowerCase() && !parsed.isImage;
                    return (
                      <button
                        key={color}
                        type="button"
                        onClick={() => selectColor(color)}
                        aria-label={t`Color ${color}`}
                        aria-pressed={selected}
                        className={`size-6 rounded-full border transition-transform hover:scale-110 active:scale-95 focus-visible:ring-2 focus-visible:ring-ring ${
                          selected
                            ? "scale-105 border-transparent ring-2 ring-foreground ring-offset-2 ring-offset-popover"
                            : "border-border"
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              aria-label={t`Image upload area`}
              aria-busy={encoding}
              disabled={encoding}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onPaste={handlePaste}
              onClick={() => fileInputRef.current?.click()}
              className={`flex w-full flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center transition-colors ${
                dragOver
                  ? "border-primary bg-primary/10"
                  : "border-border bg-muted hover:border-foreground/30"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) processImageFile(file);
                }}
              />
              <div className="mb-2 grid size-10 place-items-center rounded-full bg-secondary text-muted-foreground">
                {encoding ? <Spinner /> : <Upload size={18} strokeWidth={1.8} />}
              </div>
              <p className="text-[12.5px] font-medium text-muted-foreground">
                <Trans>Drag, drop, or paste an image</Trans>
              </p>
              <span className="mt-3 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-foreground">
                <Trans>Choose file</Trans>
              </span>
            </button>
          )}

          <DialogFooter className="border-border sm:justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex items-center gap-1.5 rounded-xl bg-secondary px-4 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-accent"
            >
              <Check size={14} />
              <Trans>Done</Trans>
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
