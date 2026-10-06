import { BOT_AVATAR_VALUE_MAX_LENGTH } from "@rakazo/contracts";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  attachedImageArtifactIds,
  encodeBotAvatarImage,
  resolveUpdateBotAvatar,
} from "./bot-avatar.js";
import { builtinAgentTools } from "./builtin-tools.js";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  "base64",
);

/** An animated GIF whose frames are seeded noise (incompressible) or flat colors. */
async function animatedGif(frameCount: number, kind: "noise" | "flat"): Promise<Buffer> {
  const size = 128;
  const frames = await Promise.all(
    Array.from({ length: frameCount }, (_, index) => {
      const pixels = Buffer.alloc(size * size * 3);
      let state = index + 1;
      for (let offset = 0; offset < pixels.length; offset += 1) {
        state = (state * 1103515245 + 12345) >>> 0;
        pixels[offset] = kind === "noise" ? state >>> 24 : (index * 40 + offset) % 256;
      }
      return sharp(pixels, { raw: { width: size, height: size, channels: 3 } })
        .png()
        .toBuffer();
    }),
  );
  return sharp(frames, { join: { animated: true } })
    .gif()
    .toBuffer();
}

async function decodedFrames(dataUrl: string) {
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  const { pages = 1, width, pageHeight } = await sharp(bytes, { animated: true }).metadata();
  return { pages, width, height: pageHeight };
}

describe("bot avatar encoding", () => {
  it("encodes an attached image as a square webp data URL", async () => {
    const dataUrl = await encodeBotAvatarImage(PNG_1X1);
    expect(dataUrl.startsWith("data:image/webp;base64,")).toBe(true);
    expect(dataUrl.length).toBeGreaterThan("data:image/webp;base64,".length);
  });

  it("keeps an animated GIF animated", async () => {
    const dataUrl = await encodeBotAvatarImage(await animatedGif(6, "flat"));
    expect(dataUrl.startsWith("data:image/webp;base64,")).toBe(true);
    await expect(decodedFrames(dataUrl)).resolves.toEqual({ pages: 6, width: 256, height: 256 });
  });

  it("uses the first frame when no animated encoding fits", async () => {
    const dataUrl = await encodeBotAvatarImage(await animatedGif(20, "noise"));
    expect(dataUrl.length).toBeLessThanOrEqual(BOT_AVATAR_VALUE_MAX_LENGTH);
    await expect(decodedFrames(dataUrl)).resolves.toMatchObject({ pages: 1, width: 256 });
  });

  it("lists attached image artifact ids in order", () => {
    expect(
      attachedImageArtifactIds([
        { kind: "text", text: "hi" },
        { kind: "image", artifactId: "img-1", mimeType: "image/png", name: "a.png" },
        { kind: "image", artifactId: "img-2", mimeType: "image/jpeg", name: "b.jpg" },
      ]),
    ).toEqual(["img-1", "img-2"]);
  });

  it("resolves hex color writes", async () => {
    await expect(
      resolveUpdateBotAvatar({
        color: "#8B5CF6::shape_2",
        sourceImageArtifactIds: [],
        loadArtifact: async () => null,
      }),
    ).resolves.toEqual({ color: "#8B5CF6::shape_2" });
  });

  it("rejects remote URLs and missing attached images", async () => {
    await expect(
      resolveUpdateBotAvatar({
        color: "https://evil.example/x.png",
        sourceImageArtifactIds: [],
        loadArtifact: async () => null,
      }),
    ).resolves.toMatchObject({ error: expect.stringContaining("hex") });
    await expect(
      resolveUpdateBotAvatar({
        useAttachedImage: true,
        sourceImageArtifactIds: [],
        loadArtifact: async () => null,
      }),
    ).resolves.toEqual({ error: "No attached image on this message." });
  });

  it("loads only the requested space image", async () => {
    const loadArtifact = async (id: string) => (id === "img-2" ? new Uint8Array(PNG_1X1) : null);
    const fromId = await resolveUpdateBotAvatar({
      artifactId: "img-2",
      sourceImageArtifactIds: ["img-1", "img-2"],
      loadArtifact,
    });
    expect("color" in fromId && fromId.color.startsWith("data:image/webp;base64,")).toBe(true);

    const fromLatest = await resolveUpdateBotAvatar({
      useAttachedImage: true,
      sourceImageArtifactIds: ["img-1", "img-2"],
      loadArtifact,
    });
    expect("color" in fromLatest && fromLatest.color.startsWith("data:image/webp;base64,")).toBe(
      true,
    );

    await expect(
      resolveUpdateBotAvatar({
        artifactId: "other-space",
        sourceImageArtifactIds: ["img-2"],
        loadArtifact,
      }),
    ).resolves.toEqual({
      error: "Image is not in this space or is not an attached picture.",
    });
  });
});

describe("update_bot tool schema", () => {
  it("exposes avatar and notifyOnFinish fields the executor applies", () => {
    const tool = builtinAgentTools.find((entry) => entry.name === "update_bot");
    if (!tool) throw new Error("missing update_bot");
    const properties =
      (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(properties).sort()).toEqual([
      "artifact_id",
      "color",
      "description",
      "name",
      "notifyOnFinish",
      "title",
      "use_attached_image",
    ]);
  });
});
