import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("sidebar shows spend for today, the week and the month, and each bot's week", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `usage-${stamp}@rakazo.test`, "password12", "Usage");
  await completeOnboarding(page);

  await page.getByPlaceholder(/Message/).fill("draft three post ideas");
  await page.keyboard.press("Enter");
  await expect(
    page.getByTestId("message-bot-bubble").getByText(/on it\. i will work this in the background/),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible({ timeout: 30_000 });

  // A bot finishing its run refreshes spend without a reload.
  const sidebar = page.locator("aside");
  await expect(sidebar.getByTestId("bot-usage").first()).toHaveText(/\d+ tokens this week/, {
    timeout: 20_000,
  });
  const spend = sidebar.getByTestId("spend-summary");
  for (const period of ["day", "week", "month"]) {
    await expect(spend.getByTestId(`spend-${period}`)).toHaveText(/\$\d/);
  }
  await expect(spend.getByText("Today", { exact: true })).toBeVisible();
  await expect(spend.locator("[title$=' tokens']")).toHaveCount(3);
  await captureScreenshot(page, testInfo, "86-sidebar-bot-usage");
});
