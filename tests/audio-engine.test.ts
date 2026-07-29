import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MultiTrackPlayer } from "@/lib/audio-engine";
import { STEMS, type StemName } from "@/lib/stems";

class FakeAudio extends EventTarget {
  preload = "";
  paused = true;
  readyState = 4;
  seeking = false;
  duration = 120;
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });

  private time = 0;

  set src(_value: string) {
    queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
  }

  get currentTime(): number {
    return this.time;
  }

  set currentTime(value: number) {
    this.time = value;
    this.seeking = true;
  }

  finishSeek(): void {
    this.seeking = false;
    this.dispatchEvent(new Event("seeked"));
  }
}

class FakeAudioContext {
  state: AudioContextState = "running";
  currentTime = 0;
  destination = {} as AudioDestinationNode;

  createMediaElementSource(): MediaElementAudioSourceNode {
    return { connect: (node: AudioNode) => node } as MediaElementAudioSourceNode;
  }

  createGain(): GainNode {
    const gain = {
      value: 1,
      setTargetAtTime: vi.fn(),
    };
    return { gain, connect: (node: AudioNode) => node } as unknown as GainNode;
  }

  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
}

const urls = Object.fromEntries(STEMS.map((stem) => [stem, `/${stem}.mp3`])) as Record<StemName, string>;
let elements: FakeAudio[];

async function loadPlayer(): Promise<MultiTrackPlayer> {
  const player = new MultiTrackPlayer();
  await player.load(urls);
  expect(elements).toHaveLength(STEMS.length);
  return player;
}

beforeEach(() => {
  elements = [];

  class AudioStub extends FakeAudio {
    constructor() {
      super();
      elements.push(this);
    }
  }

  vi.stubGlobal("Audio", AudioStub);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("HTMLMediaElement", { HAVE_FUTURE_DATA: 3 });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob(["audio"]) })));
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => `blob:${crypto.randomUUID()}`),
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal("window", {
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MultiTrackPlayer coordinated seeking", () => {
  test("resumes only after every stem has finished seeking", async () => {
    const player = await loadPlayer();
    await player.play();

    player.beginSeek();
    const commit = player.commitSeek(10);

    expect(elements.every((element) => element.currentTime === 10)).toBe(true);
    for (const element of elements) {
      expect(element.pause).toHaveBeenCalledTimes(1);
      expect(element.play).toHaveBeenCalledTimes(1);
    }

    for (const element of elements.slice(0, -1)) element.finishSeek();
    await Promise.resolve();
    for (const element of elements) expect(element.play).toHaveBeenCalledTimes(1);

    elements.at(-1)?.finishSeek();
    await commit;
    for (const element of elements) expect(element.play).toHaveBeenCalledTimes(2);

    player.dispose();
  });

  test("keeps a paused player paused after seeking", async () => {
    const player = await loadPlayer();

    player.beginSeek();
    const commit = player.commitSeek(20);
    for (const element of elements) element.finishSeek();
    await commit;

    for (const element of elements) expect(element.play).not.toHaveBeenCalled();
    expect(player.currentTime).toBe(20);

    player.dispose();
  });

  test("does not let a superseded seek restart playback", async () => {
    const player = await loadPlayer();
    await player.play();

    player.beginSeek();
    const staleCommit = player.commitSeek(30);
    player.beginSeek();

    for (const element of elements) element.finishSeek();
    await staleCommit;

    for (const element of elements) {
      expect(element.play).toHaveBeenCalledTimes(1);
      expect(element.paused).toBe(true);
    }

    player.dispose();
  });
});
