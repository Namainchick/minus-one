"use client";

import { STEM_COLORS, STEM_LABELS, type StemName } from "@/lib/stems";

type Props = {
  stem: StemName;
  enabled: boolean;
  volume: number;
  onToggle: () => void;
  onVolume: (v: number) => void;
};

export function ChannelStrip({ stem, enabled, volume, onToggle, onVolume }: Props) {
  const color = STEM_COLORS[stem];
  return (
    <div
      data-testid={`channel-${stem}`}
      data-enabled={enabled}
      className={`border-[3px] border-ink p-3 text-center shadow-poster transition-opacity ${
        enabled ? "bg-white" : "bg-neutral-100 opacity-55"
      }`}
    >
      <p className={`text-[11px] font-bold ${enabled ? "" : "line-through"}`}>{STEM_LABELS[stem]}</p>

      <button
        type="button"
        aria-label={`${STEM_LABELS[stem]} on/off`}
        aria-pressed={enabled}
        onClick={onToggle}
        className="mx-auto mt-2 flex h-9 w-9 items-center justify-center border-[3px] border-ink transition-transform active:translate-y-0.5"
        style={{ background: enabled ? color : "#ffffff" }}
      >
        <span
          className="h-2 w-2 rounded-full"
          style={{
            background: enabled ? "#ffffff" : "#bbbbbb",
            boxShadow: enabled ? "0 0 6px #ffffff" : "none",
          }}
        />
      </button>

      <div className="mt-3 flex h-24 items-center justify-center">
        <input
          type="range"
          aria-label={`${STEM_LABELS[stem]} volume`}
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onVolume(Number(e.target.value))}
          className="w-24 -rotate-90 accent-ink"
          style={{ accentColor: color }}
        />
      </div>

      <p className={`mt-1 h-4 text-[9px] font-bold ${enabled ? "invisible" : ""}`}>YOU PLAY!</p>
    </div>
  );
}
