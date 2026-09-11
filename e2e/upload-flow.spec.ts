import { expect, test } from "@playwright/test";

function makeWavBuffer(seconds: number, sampleRate = 8000): Buffer {
  const numSamples = Math.floor(seconds * sampleRate);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(dataSize, 40);
  return buf;
}

test("upload runs through processing and lands in the player", async ({ page }) => {
  await page.goto("/");

  await page
    .getByRole("button", { name: /drop an mp3, wav or m4a here/i })
    .locator("input[type=file]")
    .setInputFiles({ name: "probe.wav", mimeType: "audio/wav", buffer: makeWavBuffer(3) });

  // Processing-Ansicht mit Statuszeilen
  await expect(page.getByTestId("processing")).toBeVisible();

  // Mock schließt nach ~4s ab -> Player
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible({ timeout: 30_000 });
});

test("file too big shows the poster error box with the demo escape hatch", async ({ page }) => {
  await page.goto("/");

  const big = Buffer.alloc(15 * 1024 * 1024 + 1);
  big.write("ID3", 0);
  await page
    .getByRole("button", { name: /drop an mp3, wav or m4a here/i })
    .locator("input[type=file]")
    .setInputFiles({ name: "riesig.mp3", mimeType: "audio/mpeg", buffer: big });

  // Next.js Dev-Mode rendert zusätzlich einen leeren role="alert" Route-Announcer
  // (#__next-route-announcer__) -> auf die PosterBox eingrenzen (enthält immer eine Überschrift).
  const alert = page.getByRole("alert").filter({ has: page.getByRole("heading") });
  await expect(alert).toContainText("TOO BIG");
  await expect(alert.getByRole("button", { name: /load the demo song/i })).toBeVisible();
});

test("wrong format shows the poster error box", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: /drop an mp3, wav or m4a here/i })
    .locator("input[type=file]")
    .setInputFiles({ name: "notiz.txt", mimeType: "text/plain", buffer: Buffer.from("kein audio") });
  const alert = page.getByRole("alert").filter({ has: page.getByRole("heading") });
  await expect(alert).toContainText("WRONG FORMAT");
});

test("rate limit shows the poster box without retry, demo stays reachable", async ({ page }) => {
  await page.route("**/api/separate", (route) =>
    route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "rate_limited" }) }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: /drop an mp3, wav or m4a here/i })
    .locator("input[type=file]")
    .setInputFiles({ name: "probe.wav", mimeType: "audio/wav", buffer: makeWavBuffer(3) });
  const alert = page.getByRole("alert").filter({ has: page.getByRole("heading") });
  await expect(alert).toContainText("SHORT BREAK");
  await expect(alert.getByRole("button", { name: /try again/i })).toHaveCount(0);
  await expect(alert.getByRole("button", { name: /load the demo song/i })).toBeVisible();
});

test("budget used up shows the poster box without retry", async ({ page }) => {
  await page.route("**/api/separate", (route) =>
    route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "budget_exhausted" }) }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: /drop an mp3, wav or m4a here/i })
    .locator("input[type=file]")
    .setInputFiles({ name: "probe.wav", mimeType: "audio/wav", buffer: makeWavBuffer(3) });
  const alert = page.getByRole("alert").filter({ has: page.getByRole("heading") });
  await expect(alert).toContainText("DAILY BUDGET USED UP");
  await expect(alert.getByRole("button", { name: /try again/i })).toHaveCount(0);
});

test("demo escape hatch during processing leads to the player", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: /drop an mp3, wav or m4a here/i })
    .locator("input[type=file]")
    .setInputFiles({ name: "probe.wav", mimeType: "audio/wav", buffer: makeWavBuffer(3) });
  const processing = page.getByTestId("processing");
  await expect(processing).toBeVisible();
  await processing.getByRole("button", { name: /load the demo song/i }).click();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible({ timeout: 20_000 });
});
