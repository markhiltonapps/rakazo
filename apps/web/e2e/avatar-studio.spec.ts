import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("bot settings open Avatar Studio on the Bot tab", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `avatar-studio-${stamp}@rakazo.test`, "password12", "Avatar Studio");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  await page.getByTestId("bot-settings-trigger").click();
  const settings = page.getByTestId("bot-settings");
  await expect(settings).toBeVisible();

  await settings.getByTestId("avatar-studio-trigger").click();
  const studio = page.getByTestId("avatar-studio");
  await expect(studio).toBeVisible();
  await expect(studio.getByText("Avatar Studio", { exact: true })).toBeVisible();
  await expect(studio.getByRole("button", { name: "Bot", exact: true })).toBeVisible();
  await expect(studio.getByRole("button", { name: "Upload", exact: true })).toBeVisible();
  await expect(studio.getByRole("button", { name: "Generate" })).toHaveCount(0);
  await expect(studio.getByTestId("avatar-studio-bot-tab")).toBeVisible();
  await expect(studio.getByText("Shape", { exact: true })).toBeVisible();
  await expect(studio.getByText("Color", { exact: true })).toBeVisible();

  await captureScreenshot(page, testInfo, "avatar-studio-bot-tab");
});

/** Three flat-color 48x48 frames. */
const ANIMATED_GIF = Buffer.from(
  "R0lGODlhMAAwAIAAAExpcXw67SH/C05FVFNDQVBFMi4wAwEAAAAh+QQFFAAAACwAAAAAMAAwAAACMYyPqcvtD6OctNqLs968+w+G4kiW5omm6sq27gvH8kzX9o3n+s73/g8MCofEovHoKQAAIfkEBQAAAAAsAAAAADAAMACATGlx+XMWAjGMj6nL7Q+jnLTai7PevPsPhuJIluaJpurKtu4Lx/JM1/aN5/rO9/4PDAqHxKLx6CkAACH5BAUAAAAALAAAAAAwADAAgExpcQ6l6QIxjI+py+0Po5y02ouz3rz7D4biSJbmiabqyrbuC8fyTNf2jef6zvf+DwwKh8Si8egpAAA7",
  "base64",
);

test("an uploaded animated GIF stays animated as the bot avatar", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `avatar-animated-${stamp}@rakazo.test`, "password12", "Animated Avatar");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  await page.getByTestId("bot-settings-trigger").click();
  const settings = page.getByTestId("bot-settings");
  await settings.getByTestId("avatar-studio-trigger").click();
  const studio = page.getByTestId("avatar-studio");
  await studio.getByRole("button", { name: "Upload", exact: true }).click();
  const saved = page.waitForResponse(
    (response) => response.url().includes("/rpc/bots/update") && response.ok(),
  );
  await studio.locator('input[type="file"]').setInputFiles({
    name: "wave.gif",
    mimeType: "image/gif",
    buffer: ANIMATED_GIF,
  });
  await expect(studio).toBeHidden();
  await saved;

  await page.reload();
  await page.getByTestId("bot-settings-trigger").click();
  const avatar = page
    .getByTestId("bot-settings")
    .getByTestId("avatar-studio-trigger")
    .locator("img");
  await expect(avatar).toHaveAttribute("src", /^data:image\/webp;base64,/);
  const frameCount = await avatar.evaluate(async (img: HTMLImageElement) => {
    const data = await (await fetch(img.src)).arrayBuffer();
    const decoder = new ImageDecoder({ data, type: "image/webp" });
    await decoder.tracks.ready;
    return decoder.tracks.selectedTrack?.frameCount;
  });
  expect(frameCount).toBe(3);

  await captureScreenshot(page, testInfo, "avatar-studio-animated-upload");
});
