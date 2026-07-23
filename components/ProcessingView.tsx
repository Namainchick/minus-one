"use client";

import { useEffect, useState } from "react";
import { PROCESSING_LINES } from "@/lib/messages";

type Props = { label: string; onDemo?: () => void };

export function ProcessingView({ label, onDemo }: Props) {
  const [lineIndex, setLineIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const lineTimer = window.setInterval(
      () => setLineIndex((i) => (i + 1) % PROCESSING_LINES.length),
      2500,
    );
    const secTimer = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => {
      window.clearInterval(lineTimer);
      window.clearInterval(secTimer);
    };
  }, []);

  const remaining = Math.max(0, 75 - elapsed); // grobe, ehrliche Schätzung (30–90s typisch)

  return (
    <div className="mx-auto mt-14 max-w-xl text-center" data-testid="processing">
      <h2 className="font-display text-3xl uppercase">{label}</h2>
      <div className="mt-6 h-7 border-[3px] border-ink shadow-poster">
        <div
          className="h-full animate-pulse bg-[repeating-linear-gradient(90deg,#ffde00_0_14px,#111_14px_16px)]"
          style={{ width: `${Math.min(95, (elapsed / 90) * 100)}%` }}
        />
      </div>
      <p className="mt-5 text-sm font-bold" aria-live="polite">
        » {PROCESSING_LINES[lineIndex]} «
      </p>
      <p className="mt-2 text-xs text-neutral-500">
        {remaining > 0 ? `noch ~${remaining} Sekunden` : "gleich fertig…"}
      </p>
      {onDemo && (
        <button
          type="button"
          onClick={onDemo}
          className="mt-8 border-[3px] border-ink bg-poster-red px-4 py-2 text-sm font-bold uppercase text-white shadow-poster transition-transform active:translate-x-1 active:translate-y-1 active:shadow-none"
        >
          Keine Lust zu warten? Demo-Song laden →
        </button>
      )}
    </div>
  );
}
