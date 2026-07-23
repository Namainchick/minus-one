import { STEMS, type StemName } from "./stems";

const MASTER: StemName = "vocals";
const DRIFT_CHECK_MS = 500;
const DRIFT_THRESHOLD_S = 0.04;
const GAIN_RAMP_S = 0.015;

/**
 * Spielt 6 Stems synchron ab: <audio>-Elemente (Streaming-Decode, wenig RAM)
 * an einer Web-Audio-Graph mit GainNode pro Spur. Spur "vocals" ist Taktgeber,
 * Drift > 40ms wird alle 500ms korrigiert. AudioContext entsteht erst beim
 * ersten play() (Autoplay-Policy).
 */
export class MultiTrackPlayer {
  private audio = new Map<StemName, HTMLAudioElement>();
  private gains = new Map<StemName, GainNode>();
  private volumes = new Map<StemName, number>();
  private enabled = new Map<StemName, boolean>();
  private ctx: AudioContext | null = null;
  private driftTimer: number | null = null;
  private objectUrls: string[] = [];

  async load(urls: Record<StemName, string>, onProgress?: (loadedCount: number) => void): Promise<void> {
    let loaded = 0;
    await Promise.all(
      STEMS.map(async (stem) => {
        const res = await fetch(urls[stem]);
        if (!res.ok) throw new Error(`Spur ${stem} konnte nicht geladen werden`);
        const objectUrl = URL.createObjectURL(await res.blob());
        this.objectUrls.push(objectUrl);
        const el = new Audio();
        el.preload = "auto";
        el.src = objectUrl;
        await new Promise<void>((resolve, reject) => {
          el.addEventListener("loadedmetadata", () => resolve(), { once: true });
          el.addEventListener("error", () => reject(new Error(`Spur ${stem} ist defekt`)), { once: true });
        });
        this.audio.set(stem, el);
        this.volumes.set(stem, 1);
        this.enabled.set(stem, true);
        loaded += 1;
        onProgress?.(loaded);
      }),
    );
  }

  private ensureGraph(): void {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    for (const stem of STEMS) {
      const el = this.audio.get(stem);
      if (!el) continue;
      const source = this.ctx.createMediaElementSource(el);
      const gain = this.ctx.createGain();
      gain.gain.value = this.targetGain(stem);
      source.connect(gain).connect(this.ctx.destination);
      this.gains.set(stem, gain);
    }
  }

  private targetGain(stem: StemName): number {
    return this.enabled.get(stem) ? (this.volumes.get(stem) ?? 1) : 0;
  }

  private applyGain(stem: StemName): void {
    const gain = this.gains.get(stem);
    if (!gain || !this.ctx) return;
    gain.gain.setTargetAtTime(this.targetGain(stem), this.ctx.currentTime, GAIN_RAMP_S);
  }

  get duration(): number {
    return this.audio.get(MASTER)?.duration ?? 0;
  }
  get currentTime(): number {
    return this.audio.get(MASTER)?.currentTime ?? 0;
  }
  get playing(): boolean {
    const m = this.audio.get(MASTER);
    return !!m && !m.paused;
  }

  async play(): Promise<void> {
    this.ensureGraph();
    if (this.ctx && this.ctx.state === "suspended") await this.ctx.resume();
    await Promise.all([...this.audio.values()].map((el) => el.play()));
    this.startDriftCorrection();
  }

  pause(): void {
    for (const el of this.audio.values()) el.pause();
    this.stopDriftCorrection();
  }

  seek(seconds: number): void {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    for (const el of this.audio.values()) el.currentTime = seconds;
    if (wasPlaying) void this.play();
  }

  setEnabled(stem: StemName, on: boolean): void {
    this.enabled.set(stem, on);
    this.applyGain(stem);
  }
  isEnabled(stem: StemName): boolean {
    return this.enabled.get(stem) ?? true;
  }
  setVolume(stem: StemName, volume: number): void {
    this.volumes.set(stem, Math.min(1, Math.max(0, volume)));
    this.applyGain(stem);
  }
  getVolume(stem: StemName): number {
    return this.volumes.get(stem) ?? 1;
  }

  private startDriftCorrection(): void {
    this.stopDriftCorrection();
    this.driftTimer = window.setInterval(() => {
      const master = this.audio.get(MASTER);
      if (!master || master.paused) return;
      for (const [stem, el] of this.audio) {
        if (stem === MASTER) continue;
        if (Math.abs(el.currentTime - master.currentTime) > DRIFT_THRESHOLD_S) {
          el.currentTime = master.currentTime;
        }
      }
    }, DRIFT_CHECK_MS);
  }

  private stopDriftCorrection(): void {
    if (this.driftTimer !== null) {
      window.clearInterval(this.driftTimer);
      this.driftTimer = null;
    }
  }

  dispose(): void {
    this.pause();
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
    this.audio.clear();
    this.gains.clear();
    void this.ctx?.close();
    this.ctx = null;
  }
}
