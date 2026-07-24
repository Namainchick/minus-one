"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Hero } from "@/components/Hero";
import { PlayerView } from "@/components/PlayerView";
import { PosterBox } from "@/components/PosterBox";
import { ProcessingView } from "@/components/ProcessingView";
import { UploadZone } from "@/components/UploadZone";
import { YoutubeImport } from "@/components/YoutubeImport";
import { MultiTrackPlayer } from "@/lib/audio-engine";
import { ERROR_MESSAGES, type ErrorCode } from "@/lib/messages";
import { STEMS, type StemName } from "@/lib/stems";
import { precheckFile, uploadSong } from "@/lib/upload";

const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;

type AppState =
  | { phase: "start" }
  | { phase: "uploading"; label?: string }
  | { phase: "processing"; jobId: string }
  | { phase: "loading-stems"; loaded: number; title: string }
  | { phase: "player"; title: string }
  | { phase: "error"; code: ErrorCode };

export default function Home() {
  const [state, setState] = useState<AppState>({ phase: "start" });
  const [engine, setEngine] = useState<MultiTrackPlayer | null>(null);
  const engineRef = useRef<MultiTrackPlayer | null>(null);
  const loadingRef = useRef(false);

  const loadStems = useCallback(async (urls: Record<StemName, string>, title: string) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    engineRef.current?.dispose();
    const player = new MultiTrackPlayer();
    engineRef.current = player;
    setEngine(player);
    setState({ phase: "loading-stems", loaded: 0, title });
    try {
      await player.load(urls, (loaded) => setState({ phase: "loading-stems", loaded, title }));
      setState({ phase: "player", title });
    } catch {
      setState({ phase: "error", code: "network" });
    } finally {
      loadingRef.current = false;
    }
  }, []);

  const startDemo = useCallback(async () => {
    let title = "Demo";
    try {
      const meta = (await (await fetch("/demo/meta.json")).json()) as { title?: string };
      if (meta.title) title = meta.title;
    } catch {
      // Titel ist Kosmetik — Demo trotzdem laden
    }
    const urls = Object.fromEntries(STEMS.map((s) => [s, `/demo/${s}.mp3`])) as Record<StemName, string>;
    void loadStems(urls, title);
  }, [loadStems]);

  const requestSeparation = useCallback(async (blobUrl: string) => {
    const res = await fetch("/api/separate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blobUrl }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      const code = (body.error ?? "network") as ErrorCode;
      setState({ phase: "error", code: code in ERROR_MESSAGES ? code : "network" });
      return;
    }
    const { jobId } = (await res.json()) as { jobId: string };
    setState({ phase: "processing", jobId });
  }, []);

  const startUpload = useCallback(
    async (file: File) => {
      const check = precheckFile(file);
      if (!check.ok) {
        setState({ phase: "error", code: check.reason });
        return;
      }
      setState({ phase: "uploading" });
      try {
        const blobUrl = await uploadSong(file);
        await requestSeparation(blobUrl);
      } catch {
        setState({ phase: "error", code: "network" });
      }
    },
    [requestSeparation],
  );

  const startYoutube = useCallback(
    async (url: string) => {
      setState({ phase: "uploading", label: "Song wird von YouTube geholt…" });
      try {
        const res = await fetch("/api/youtube-import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          const code = (body.error ?? "youtube_failed") as ErrorCode;
          setState({ phase: "error", code: code in ERROR_MESSAGES ? code : "youtube_failed" });
          return;
        }
        const { uploadId } = (await res.json()) as { uploadId: string };
        await requestSeparation(`local://${uploadId}`);
      } catch {
        setState({ phase: "error", code: "network" });
      }
    },
    [requestSeparation],
  );

  // Polling während der Verarbeitung
  useEffect(() => {
    if (state.phase !== "processing") return;
    const { jobId } = state;
    const startedAt = Date.now();
    const timer = window.setInterval(async () => {
      if (Date.now() - startedAt > PROCESSING_TIMEOUT_MS) {
        window.clearInterval(timer);
        setState({ phase: "error", code: "processing_failed" });
        return;
      }
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        const job = (await res.json()) as
          | { status: "queued" | "processing" }
          | { status: "failed" }
          | { status: "done"; stems: Record<StemName, string> };
        if (job.status === "done") {
          window.clearInterval(timer);
          void loadStems(job.stems, "Dein Song");
        } else if (job.status === "failed") {
          window.clearInterval(timer);
          setState({ phase: "error", code: "processing_failed" });
        }
      } catch {
        // einzelner Poll-Fehler: weiterpollen
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [state, loadStems]);

  useEffect(() => () => engineRef.current?.dispose(), []);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Hero />

      {state.phase === "start" && <UploadZone onFile={startUpload} onDemo={startDemo} />}

      {state.phase === "start" && process.env.NEXT_PUBLIC_LOCAL_UPLOAD === "1" && (
        <YoutubeImport onImport={startYoutube} />
      )}

      {state.phase === "uploading" && <ProcessingView label={state.label ?? "Song wird hochgeladen…"} />}

      {state.phase === "processing" && <ProcessingView label="Die Band wird zerlegt…" onDemo={startDemo} />}

      {state.phase === "loading-stems" && (
        <p className="mt-10 text-sm font-bold uppercase">
          Spuren laden… {state.loaded}/{STEMS.length}
        </p>
      )}

      {state.phase === "player" && engine && (
        <PlayerView engine={engine} title={state.title} />
      )}

      {state.phase === "error" && (
        <div className="mt-10">
          <PosterBox
            title={ERROR_MESSAGES[state.code].title}
            text={ERROR_MESSAGES[state.code].text}
            onRetry={
              state.code === "budget_exhausted" || state.code === "rate_limited"
                ? undefined
                : () => setState({ phase: "start" })
            }
            onDemo={startDemo}
          />
        </div>
      )}
    </main>
  );
}
