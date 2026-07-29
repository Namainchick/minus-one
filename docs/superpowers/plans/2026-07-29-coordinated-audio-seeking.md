# Coordinated Audio Seeking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent audible stem phasing after transport scrubbing by committing one coordinated seek only after the user releases the slider.

**Architecture:** Keep the six compressed `HTMLAudioElement` instances and the existing Web Audio mixer. Split seeking into begin, UI-only preview, and asynchronous commit phases; the engine pauses once, waits for every stem's `seeked` event, and resumes once. A generation counter prevents stale asynchronous seeks from restarting playback.

**Tech Stack:** Next.js 16.2.11 Client Components, React 19, TypeScript, Web Audio API, HTML media events, Vitest 4, Playwright 1.61.

---

## File Structure

- `lib/audio-engine.ts`: Own the coordinated media seek barrier, resume intent, and stale-operation protection.
- `components/Transport.tsx`: Translate pointer, touch, and keyboard slider interactions into begin/preview/commit callbacks.
- `components/PlayerView.tsx`: Keep preview time separate from the engine clock and connect the transport lifecycle to the engine.
- `tests/audio-engine.test.ts`: Deterministically test the six-element seek barrier with fake browser media objects.
- `e2e/demo-flow.spec.ts`: Verify the user-facing keyboard seek flow in a real Chromium browser.

### Task 1: Add a failing coordinated-seek engine test

**Files:**
- Create: `tests/audio-engine.test.ts`
- Test: `lib/audio-engine.ts`

- [ ] **Step 1: Create browser audio fakes and the failing tests**

Create `tests/audio-engine.test.ts` with a fake `Audio` implementation that records `play()` and `pause()`, marks itself as seeking when `currentTime` changes, and exposes `finishSeek()` to emit `seeked`. Stub `fetch`, `URL.createObjectURL`, `AudioContext`, and `window.setInterval` before loading a player.

The core assertions must be:

```ts
player.beginSeek();
const commit = player.commitSeek(10);

expect(elements.every((element) => element.currentTime === 10)).toBe(true);
for (const element of elements) expect(element.play).toHaveBeenCalledTimes(1);

for (const element of elements.slice(0, -1)) element.finishSeek();
await Promise.resolve();
for (const element of elements) expect(element.play).toHaveBeenCalledTimes(1);

elements.at(-1)?.finishSeek();
await commit;
for (const element of elements) expect(element.play).toHaveBeenCalledTimes(2);
```

Add separate cases proving that a paused player remains paused and that a superseded commit cannot resume playback.

- [ ] **Step 2: Run the new test and verify it fails for the missing API**

Run: `npx vitest run tests/audio-engine.test.ts`

Expected: FAIL because `beginSeek` and `commitSeek` do not exist.

### Task 2: Implement the coordinated seek barrier

**Files:**
- Modify: `lib/audio-engine.ts:16-121`
- Test: `tests/audio-engine.test.ts`

- [ ] **Step 1: Add seek lifecycle state and internal playback helpers**

Add these fields to `MultiTrackPlayer`:

```ts
private seekGeneration = 0;
private seekActive = false;
private resumeAfterSeek = false;
```

Separate internal pause/play behavior from public intent changes. Public `play()` and `pause()` invalidate pending seek work. `beginSeek()` records `playing`, increments the generation, and pauses all elements only once.

- [ ] **Step 2: Add a per-element seek promise**

Implement a helper that registers listeners before assigning `currentTime`, waits for `seeked`, then waits until `readyState >= HTMLMediaElement.HAVE_FUTURE_DATA` or `canplay`, and immediately resolves elements that are already aligned and ready. The helper must remove `seeked`, `canplay`, and `error` listeners on completion. Its shape is:

```ts
private seekElement(el: HTMLAudioElement, seconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const finishWhenReady = () => {
      if (el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) finish();
      else el.addEventListener("canplay", finish, { once: true });
    };
    const finish = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error("Spur konnte nicht positioniert werden"));
    };
    const cleanup = () => {
      el.removeEventListener("seeked", finishWhenReady);
      el.removeEventListener("canplay", finish);
      el.removeEventListener("error", fail);
    };

    el.addEventListener("error", fail, { once: true });
    if (!el.seeking && Math.abs(el.currentTime - seconds) < 0.001) {
      finishWhenReady();
      return;
    }
    el.addEventListener("seeked", finishWhenReady, { once: true });
    el.currentTime = seconds;
  });
}
```

- [ ] **Step 3: Replace immediate seek/replay with `beginSeek()` and `commitSeek()`**

`commitSeek(seconds)` must clamp the target to the playable duration, await all six `seekElement` promises, exit if its generation is stale, and resume exactly once only when playback was active before scrubbing. A current-operation error pauses all elements and rejects; stale errors exit without changing newer state.

- [ ] **Step 4: Invalidate asynchronous work in `dispose()`**

Increment `seekGeneration`, clear seek intent, pause, then revoke object URLs and close the context as before.

- [ ] **Step 5: Run the engine tests**

Run: `npx vitest run tests/audio-engine.test.ts`

Expected: PASS for coordinated resume, paused seek, superseded seek, and disposal behavior.

- [ ] **Step 6: Commit the engine behavior**

```bash
git add lib/audio-engine.ts tests/audio-engine.test.ts
git commit -m "fix: coordinate stem seeking"
```

### Task 3: Make the transport commit only on release

**Files:**
- Modify: `components/Transport.tsx:1-57`
- Modify: `components/PlayerView.tsx:1-61`
- Test: `e2e/demo-flow.spec.ts`

- [ ] **Step 1: Change `Transport` to explicit seek lifecycle callbacks**

Replace `onSeek` with:

```ts
onSeekStart: () => void;
onSeekPreview: (seconds: number) => void;
onSeekCommit: (seconds: number) => void;
```

Use a `useRef(false)` interaction guard. Begin on pointer down or the first non-repeating seek-key down, preview through `onChange`, and commit the current range value on pointer up, pointer cancel, blur, or seek-key up. Recognized keys are `ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`, `PageUp`, `PageDown`, `Home`, and `End`. The guard must prevent duplicate commits from overlapping pointer-up, lost-capture, or blur events.

- [ ] **Step 2: Keep the preview separate in `PlayerView`**

Add `previewTime: number | null` and a request-generation ref. While previewing, render `previewTime` instead of the 250 ms engine clock. Connect callbacks as follows:

```tsx
onSeekStart={() => {
  seekRequestRef.current += 1;
  engine.beginSeek();
  setPreviewTime(engine.currentTime);
  forceUpdate();
}}
onSeekPreview={(seconds) => setPreviewTime(seconds)}
onSeekCommit={(seconds) => {
  const request = seekRequestRef.current;
  setPreviewTime(seconds);
  setTime(seconds);
  void engine
    .commitSeek(seconds)
    .catch(() => undefined)
    .finally(() => {
      if (seekRequestRef.current !== request) return;
      setPreviewTime(null);
      setTime(engine.currentTime);
      forceUpdate();
    });
}}
```

The timer must continue updating actual engine time, but the rendered transport value is `previewTime ?? time`.

- [ ] **Step 3: Update the browser regression test before relying on the implementation**

Replace the programmatic slider `fill("10")` with real keyboard and pointer interactions that exercise begin/change/commit. First seek with a keyboard key:

```ts
const position = page.getByLabel("Position im Song");
await position.focus();
await page.keyboard.press("PageUp");
await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
await expect
  .poll(async () => (await page.locator("text=/\\d+:\\d\\d \\/ \\d+:\\d\\d/").innerText()).split(" / ")[0])
  .not.toBe("0:00");
```

Then use `boundingBox()` plus `page.mouse.down()`, `page.mouse.move()`, and `page.mouse.up()` to perform a pointer scrub and assert that the visible time changes and playback resumes. Dispatch the same pointer lifecycle once with `pointerType: "touch"` to prove touch input reaches the shared pointer handlers.

- [ ] **Step 4: Run focused lint and E2E tests**

Run: `npm run lint -- components/Transport.tsx components/PlayerView.tsx lib/audio-engine.ts tests/audio-engine.test.ts e2e/demo-flow.spec.ts`

Expected: exit code 0.

Run: `npx playwright test e2e/demo-flow.spec.ts`

Expected: the demo flow passes and playback continues after the committed seek.

- [ ] **Step 5: Commit the UI lifecycle**

```bash
git add components/Transport.tsx components/PlayerView.tsx e2e/demo-flow.spec.ts
git commit -m "fix: commit audio seek on slider release"
```

### Task 4: Verify the complete change

**Files:**
- Verify only; do not modify the user's existing `public/demo/*.mp3` or `public/demo/meta.json` changes.

- [ ] **Step 1: Run unit tests**

Run: `npm test`

Expected: all Vitest tests pass.

- [ ] **Step 2: Run lint**

Run: `npm run lint`

Expected: exit code 0.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: Next.js 16.2.11 production build succeeds.

- [ ] **Step 4: Run the complete browser suite**

Run: `npm run test:e2e`

Expected: all Playwright tests pass.

- [ ] **Step 5: Confirm the working tree contains only intended source/test changes plus Nam's pre-existing demo audio changes**

Run: `git status --short`

Expected: the pre-existing modified `public/demo/*.mp3` and `public/demo/meta.json` remain untouched; all implementation files are committed.
