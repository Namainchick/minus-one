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
 * Eine Instanz pro Song: für einen neuen Song eine neue MultiTrackPlayer-Instanz
 * erzeugen und die alte per dispose() freigeben — load() darf nur einmal laufen.
 */
export class MultiTrackPlayer {
  private audio = new Map<StemName, HTMLAudioElement>();
  private gains = new Map<StemName, GainNode>();
  private volumes = new Map<StemName, number>();
  private enabled = new Map<StemName, boolean>();
  private ctx: AudioContext | null = null;
  private driftTimer: number | null = null;
  private objectUrls: string[] = [];
  private failed = false;
  private seekGeneration = 0;
  private seekActive = false;
  private resumeAfterSeek = false;

  async load(urls: Record<StemName, string>, onProgress?: (loadedCount: number) => void): Promise<void> {
    let loaded = 0;
    await Promise.all(
      STEMS.map(async (stem) => {
        try {
          const res = await fetch(urls[stem]);
          if (!res.ok) throw new Error(`Stem ${stem} could not be loaded`);
          const objectUrl = URL.createObjectURL(await res.blob());
          if (this.failed) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          this.objectUrls.push(objectUrl);
          const el = new Audio();
          el.preload = "auto";
          el.src = objectUrl;
          await new Promise<void>((resolve, reject) => {
            el.addEventListener("loadedmetadata", () => resolve(), { once: true });
            el.addEventListener("error", () => reject(new Error(`Stem ${stem} is broken`)), { once: true });
          });
          if (this.failed) return;
          this.audio.set(stem, el);
          this.volumes.set(stem, 1);
          this.enabled.set(stem, true);
          loaded += 1;
          onProgress?.(loaded);
        } catch (err) {
          this.failed = true;
          throw err;
        }
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

  private async playElements(): Promise<void> {
    this.ensureGraph();
    if (this.ctx && this.ctx.state === "suspended") await this.ctx.resume();
    try {
      await Promise.all([...this.audio.values()].map((el) => el.play()));
    } catch (err) {
      this.pauseElements();
      throw err;
    }
    this.startDriftCorrection();
  }

  private pauseElements(): void {
    for (const el of this.audio.values()) el.pause();
    this.stopDriftCorrection();
  }

  async play(): Promise<void> {
    this.seekGeneration += 1;
    this.seekActive = false;
    this.resumeAfterSeek = false;
    await this.playElements();
  }

  pause(): void {
    this.seekGeneration += 1;
    this.seekActive = false;
    this.resumeAfterSeek = false;
    this.pauseElements();
  }

  beginSeek(): void {
    if (this.seekActive) return;
    this.seekActive = true;
    this.resumeAfterSeek = this.resumeAfterSeek || this.playing;
    this.seekGeneration += 1;
    this.pauseElements();
  }

  private seekElement(el: HTMLAudioElement, seconds: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        el.removeEventListener("seeked", finishWhenReady);
        el.removeEventListener("canplay", finish);
        el.removeEventListener("error", fail);
      };
      const finish = () => {
        cleanup();
        resolve();
      };
      const finishWhenReady = () => {
        if (el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) finish();
        else el.addEventListener("canplay", finish, { once: true });
      };
      const fail = () => {
        cleanup();
        reject(new Error("Stem could not be positioned"));
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

  async commitSeek(seconds: number): Promise<void> {
    if (!this.seekActive) this.beginSeek();
    this.seekActive = false;
    const generation = ++this.seekGeneration;
    const duration = this.duration;
    const finiteSeconds = Number.isFinite(seconds) ? seconds : 0;
    const target = Math.max(0, Number.isFinite(duration) && duration > 0 ? Math.min(finiteSeconds, duration) : finiteSeconds);

    try {
      await Promise.all([...this.audio.values()].map((el) => this.seekElement(el, target)));
      if (generation !== this.seekGeneration) return;
      if (this.resumeAfterSeek) await this.playElements();
      if (generation === this.seekGeneration) this.resumeAfterSeek = false;
    } catch (err) {
      if (generation !== this.seekGeneration) return;
      this.resumeAfterSeek = false;
      this.pauseElements();
      throw err;
    }
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
    this.seekGeneration += 1;
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
    this.audio.clear();
    this.gains.clear();
    void this.ctx?.close();
    this.ctx = null;
  }
}
