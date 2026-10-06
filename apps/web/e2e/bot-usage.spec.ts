import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("sidebar shows each bot's tokens for the last 7 days", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `usage-${stamp}@rakazo.test`, "password12", "Usage");
  await completeOnboarding(page);

  await page.getByPlaceholder(/Message/).fill("draft three post ideas");
  await page.keyboard.press("Enter");
  await expect(
    page.getByTestId("message-bot-bubble").getByText(/on it\. i will work this in the background/),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 30_000 });

  // The sidebar refreshes spend once a minute; reload to read it now.
  await page.reload();
  const usage = page.locator("aside").getByTestId("bot-usage").first();
  await expect(usage).toHaveText(/\d+ tokens this week/, { timeout: 20_000 });
  await expect(usage).toHaveAttribute("title", "Last 7 days");
  await captureScreenshot(page, testInfo, "86-sidebar-bot-usage");
});
