import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

const SUGGESTION = "Thursday afternoon works for me.";

test("a bot's question offers its suggested reply in the message box", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `suggested-reply-${stamp}@rakazo.test`, "password12", "Suggest");
  await completeOnboarding(page);

  const composer = page.getByRole("combobox", { name: /^Message / });
  await composer.fill("ask me which day works for the review");
  await page.keyboard.press("Enter");
  await expect(
    page.getByTestId("message-bot-bubble").getByText(/which day works best for the review/),
  ).toBeVisible({ timeout: 30_000 });

  // The suggestion waits, faded, in the empty box until the person takes it.
  await expect(composer).toHaveAttribute("placeholder", SUGGESTION, { timeout: 20_000 });
  await expect(composer).toHaveValue("");
  await captureScreenshot(page, testInfo, "87-suggested-reply");

  await composer.press("ArrowRight");
  await expect(composer).toHaveValue(SUGGESTION);
  await composer.fill("");
  await composer.press("Tab");
  await expect(composer).toHaveValue(SUGGESTION);

  // Replying retires it.
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  await expect(composer).toHaveAttribute("placeholder", /^Message /, { timeout: 20_000 });
});
