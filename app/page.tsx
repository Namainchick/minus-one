"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Hero } from "@/components/Hero";
import { PosterBox } from "@/components/PosterBox";
import { UploadZone } from "@/components/UploadZone";
import { MultiTrackPlayer } from "@/lib/audio-engine";
import { ERROR_MESSAGES, type ErrorCode } from "@/lib/messages";
import { STEMS, type StemName } from "@/lib/stems";
import { precheckFile, uploadSong } from "@/lib/upload";

type AppState =
  | { phase: "start" }
  | { phase: "uploading" }
  | { phase: "processing"; jobId: string }
  | { phase: "loading-stems"; loaded: number; title: string }
  | { phase: "player"; title: string }
  | { phase: "error"; code: ErrorCode };

export default function Home() {
  const [state, setState] = useState<AppState>({ phase: "start" });
  const [engine, setEngine] = useState<MultiTrackPlayer | null>(null);
  const engineRef = useRef<MultiTrackPlayer | null>(null);

  const loadStems = useCallback(async (urls: Record<StemName, string>, title: string) => {
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
      } catch {
        setState({ phase: "error", code: "network" });
      }
    },
    [],
  );

  // Polling während der Verarbeitung
  useEffect(() => {
    if (state.phase !== "processing") return;
    const { jobId } = state;
    const timer = window.setInterval(async () => {
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

      {state.phase === "uploading" && (
        <p className="mt-10 text-sm font-bold uppercase">Song wird hochgeladen…</p>
      )}

      {state.phase === "processing" && (
        <p className="mt-10 text-sm font-bold uppercase">Die Band wird zerlegt…</p>
      )}

      {state.phase === "loading-stems" && (
        <p className="mt-10 text-sm font-bold uppercase">
          Spuren laden… {state.loaded}/{STEMS.length}
        </p>
      )}

      {state.phase === "player" && engine && (
        <p className="mt-10 text-sm font-bold uppercase">Player kommt in Task 14: {state.title}</p>
      )}

      {state.phase === "error" && (
        <div className="mt-10">
          <PosterBox
            title={ERROR_MESSAGES[state.code].title}
            text={ERROR_MESSAGES[state.code].text}
            onRetry={() => setState({ phase: "start" })}
            onDemo={startDemo}
          />
        </div>
      )}
    </main>
  );
}
