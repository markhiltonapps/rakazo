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

const GALLERY_AVATAR =
  "data:image/webp;base64,UklGRiICAABXRUJQVlA4IBYCAADQDQCdASpAAEAAPm0skkWkIqGYDAWAQAbEtgBl0NdeTx4e5HgbEE53n23eo1+nPWA8wHPk+oB/hv9H1gHoAfsB1oX7MtIDvBlAwwTNZ90Tvtf38T/vLtrXEPWxbuhrZF9S9cibTQcb36SCms4qjd6GsndW9exWgAD++kXHoGeJxphxCPeAPhgTCCaiGWQiIBiWRB8KtJjrnR+/vpM5AIap78Po/eNSIZudSTdTFhvFTnoQ4gytomJ3gCz7d7NXpP4yI1ukD6o1dLPssP//G2sOboVPBqULLm8qwuU5xHrB2YUpJkuLsEp+ls6/5nEV0Ojb9xV/RT6TqQGrbAJpaAst6tCacgD2cqqGa3lacOhNzGLM8UZ1BCxBXRcq+KjkxsA+p/LWkINBqhIgqIchQ4QgmlDI/lvFBoLutqg8fc4O7sKOlciyLQEb3BbKFpx/vZOyCpBZLcgv9+DNwZTplt6IVK4eTL/I16ApqEYnAgLoO5J+Dwfroii9TqWFho0zF9aW2SOw23xocEhLCbmJiwCAJuJUvhJslpt9FnhUbT+O7khG34+XSkVv8wSjcbOXaFUbKE6Q75avMf6d4ltXxgcTYdjoMfORH57SajDxVQBFdbjUmfnzWKqwM1q3i2QUAlpkJzwIc7gqOMdhKyQQLA8WOCDNgsJDcUWCNL3ajoN/nnX1s8WeP+TFBJy9+cMNP6LcHxoYAAA=";

test("the shared avatar gallery offers its avatars and takes new ones", async ({
  page,
}, testInfo) => {
  // Gallery curation is limited to the deployment owner; the API suite covers that check.
  await page.route("**/rpc/avatarGallery/list", (route) =>
    route.fulfill({
      json: { json: { items: [{ id: "gallery-1", value: GALLERY_AVATAR }], canManage: true } },
    }),
  );
  await page.route("**/rpc/avatarGallery/add", (route) =>
    route.fulfill({
      json: { json: { id: "gallery-2", value: route.request().postDataJSON().json.value } },
    }),
  );
  const stamp = Date.now();
  await signup(page, `avatar-gallery-${stamp}@rakazo.test`, "password12", "Avatar Gallery");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  await page.getByTestId("bot-settings-trigger").click();
  const settings = page.getByTestId("bot-settings");
  const trigger = settings.getByTestId("avatar-studio-trigger");
  await trigger.click();
  const studio = page.getByTestId("avatar-studio");
  const gallery = studio.getByTestId("avatar-gallery");
  await gallery.getByRole("button", { name: "Gallery avatar 1", exact: true }).click();
  await expect(trigger.locator("img")).toHaveAttribute("src", GALLERY_AVATAR);
  await expect(gallery.getByRole("button", { name: "Add this avatar to the gallery" })).toHaveCount(
    0,
  );

  await studio.getByRole("button", { name: "Upload", exact: true }).click();
  await studio.locator('input[type="file"]').setInputFiles({
    name: "wave.gif",
    mimeType: "image/gif",
    buffer: ANIMATED_GIF,
  });
  await expect(studio).toBeHidden();
  await trigger.click();
  await studio.getByRole("button", { name: "Bot", exact: true }).click();
  await gallery.getByRole("button", { name: "Add this avatar to the gallery" }).click();
  await expect(
    gallery.getByRole("button", { name: "Gallery avatar 2", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(gallery.getByRole("button", { name: "Remove from gallery" })).toHaveCount(2);

  await captureScreenshot(page, testInfo, "avatar-studio-gallery");
});
