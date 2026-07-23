import { expect, test } from "@playwright/test";

test("Demo laden, abspielen, Kanäle schalten, Fader, Seek", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /demo-song laden/i }).first().click();

  // Player erscheint, sobald alle 6 Spuren geladen sind
  const playButton = page.getByRole("button", { name: "Abspielen" });
  await expect(playButton).toBeVisible({ timeout: 20_000 });

  await playButton.click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

  // Kanal ausschalten
  const bass = page.getByTestId("channel-bass");
  await expect(bass).toHaveAttribute("data-enabled", "true");
  await bass.getByRole("button", { name: /bass an\/aus/i }).click();
  await expect(bass).toHaveAttribute("data-enabled", "false");
  await expect(bass.getByText("DU SPIELST!")).toBeVisible();

  // Wieder einschalten
  await bass.getByRole("button", { name: /bass an\/aus/i }).click();
  await expect(bass).toHaveAttribute("data-enabled", "true");

  // Fader bewegen
  await page.getByLabel("DRUMS Lautstärke").fill("0.3");

  // Seek: Zeit springt und läuft weiter
  await page.getByLabel("Position im Song").fill("10");
  await expect
    .poll(async () => {
      const text = await page.locator("text=/\\d+:\\d\\d \\/ \\d+:\\d\\d/").innerText();
      return text.split(" / ")[0];
    }, { timeout: 5000 })
    .not.toBe("0:00");
});
