import { expect, test } from "@playwright/test";

test("load demo, play, toggle channels, fader, seek", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /load the demo song/i }).first().click();

  // Player erscheint, sobald alle 6 Spuren geladen sind
  const playButton = page.getByRole("button", { name: "Play" });
  await expect(playButton).toBeVisible({ timeout: 20_000 });

  await playButton.click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

  // Kanal ausschalten
  const bass = page.getByTestId("channel-bass");
  await expect(bass).toHaveAttribute("data-enabled", "true");
  await bass.getByRole("button", { name: /bass on\/off/i }).click();
  await expect(bass).toHaveAttribute("data-enabled", "false");
  await expect(bass.getByText("YOU PLAY!")).toBeVisible();

  // Wieder einschalten
  await bass.getByRole("button", { name: /bass on\/off/i }).click();
  await expect(bass).toHaveAttribute("data-enabled", "true");

  // Fader bewegen
  await page.getByLabel("DRUMS volume").fill("0.3");

  const position = page.getByLabel("Position in song");

  // Tastatur-Seek: während der Taste pausiert, erst beim Loslassen weiter
  await position.focus();
  await page.keyboard.down("PageUp");
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await page.keyboard.up("PageUp");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

  // Pointer-Seek folgt demselben Begin/Preview/Commit-Ablauf.
  const box = await position.boundingBox();
  if (!box) throw new Error("position slider has no size");
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

  // Touch verwendet dieselben Pointer-Handler.
  await position.dispatchEvent("pointerdown", { pointerId: 7, pointerType: "touch", bubbles: true });
  await position.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = String(Number(input.max) * 0.6);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await position.dispatchEvent("pointerup", { pointerId: 7, pointerType: "touch", bubbles: true });
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

  await expect
    .poll(async () => {
      const text = await page.locator("text=/\\d+:\\d\\d \\/ \\d+:\\d\\d/").innerText();
      return text.split(" / ")[0];
    }, { timeout: 5000 })
    .not.toBe("0:00");
});
