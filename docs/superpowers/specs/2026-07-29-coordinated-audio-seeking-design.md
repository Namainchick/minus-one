# Coordinated Audio Seeking

**Date:** 2026-07-29

## Problem

The player currently calls `seek()` for every slider update while the user drags the transport control. Each call pauses six independent `HTMLAudioElement` instances, changes their positions, and immediately starts them again. Media seeking is asynchronous, so repeated calls overlap and the six decoders can resume at different moments. The resulting small timing differences are audible as distortion, echo, or phasing after scrubbing.

## Goal

Seeking must not leave the six stems out of sync. Existing behavior must remain available:

- low-memory playback through compressed media elements;
- play and pause;
- transport seeking with mouse, touch, and keyboard;
- independent stem mute and volume controls;
- automatic drift correction;
- the existing upload, separation, and demo flows.

## Interaction Design

When the user starts manipulating the position slider, playback pauses once. While the slider is moving, only the displayed preview position changes. When the interaction finishes, the player commits one seek to the final position.

If playback was active before scrubbing, it resumes after all six stems have completed the seek and are ready. If playback was paused before scrubbing, it remains paused at the new position.

Pointer and touch interactions commit on release or cancellation. Keyboard interactions preview while a seek key is held and commit on key release. A direct click on the slider follows the same begin, preview, and commit sequence.

## Audio Engine Design

`MultiTrackPlayer` will expose an explicit three-step scrubbing lifecycle instead of treating every slider update as a complete seek:

1. `beginSeek()` records whether playback was active and pauses all stems once.
2. Preview updates remain in React state and do not mutate media elements.
3. `commitSeek(seconds)` sets the target on every media element, waits for every element to finish seeking, and then resumes once when appropriate.

The engine will attach each completion listener before assigning `currentTime`, so fast browser completions cannot be missed. Elements already at the requested time count as complete without waiting for an event that may never fire.

Each seek operation receives a monotonically increasing generation number. Completion from an older operation cannot restart playback or overwrite the state of a newer operation. Disposing the player also invalidates outstanding work.

The existing `play()`, `pause()`, gain controls, object-URL loading, and drift correction remain intact. Drift correction starts only after the coordinated resume has completed.

## Component State

`PlayerView` will keep separate state for:

- the engine's actual playback position;
- whether the user is currently scrubbing;
- the preview position shown by the slider.

The periodic engine-time update will not replace the preview position while scrubbing. `Transport` will receive separate callbacks for beginning, previewing, and committing a seek.

## Error Handling

If any media element rejects playback after a committed seek, the engine pauses all stems and leaves the player in a consistent paused state. A stale or disposed operation exits without resuming playback. The UI continues to reflect the engine as the source of truth.

## Testing

Browser-level tests will cover the behavior that caused the regression:

- dragging while playing pauses once and commits only the final slider position;
- playback does not resume until every stem reports that seeking finished;
- all stem times are aligned after the commit;
- seeking while paused changes the position without starting playback;
- repeated or superseded seek operations cannot restart stale playback;
- mouse/touch-style pointer input and keyboard input both commit correctly.

Existing demo and upload tests must continue to pass. Lint, unit tests, and the production build remain required validation gates.

## Non-goals

This change does not replace the six media elements with fully decoded `AudioBuffer` instances, because that would substantially increase memory use on mobile devices. It also does not change Demucs output formats or server-side audio processing; the defect is in the browser seek lifecycle.
