"use client";

import { useRef } from "react";

const SEEK_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);

type Props = {
  title: string;
  playing: boolean;
  currentTime: number;
  duration: number;
  onPlayPause: () => void;
  onSeekStart: () => void;
  onSeekPreview: (seconds: number) => void;
  onSeekCommit: (seconds: number) => void;
};

function fmt(s: number): string {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function Transport({
  title,
  playing,
  currentTime,
  duration,
  onPlayPause,
  onSeekStart,
  onSeekPreview,
  onSeekCommit,
}: Props) {
  const seekActive = useRef(false);

  const beginSeek = () => {
    if (seekActive.current) return;
    seekActive.current = true;
    onSeekStart();
  };

  const commitSeek = (seconds: number) => {
    if (!seekActive.current) return;
    seekActive.current = false;
    onSeekCommit(seconds);
  };

  return (
    <div className="flex items-center gap-4 border-[3px] border-ink p-4 shadow-poster-lg">
      <button
        type="button"
        aria-label={playing ? "Pause" : "Abspielen"}
        onClick={onPlayPause}
        className="flex h-12 w-12 flex-none items-center justify-center bg-ink text-white transition-transform active:translate-y-0.5"
      >
        {playing ? (
          <span className="flex gap-1">
            <span className="h-4 w-1.5 bg-white" />
            <span className="h-4 w-1.5 bg-white" />
          </span>
        ) : (
          <span className="ml-1 h-0 w-0 border-y-[10px] border-l-[16px] border-y-transparent border-l-white" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex justify-between text-[11px] font-bold uppercase">
          <span className="truncate">{title}</span>
          <span className="ml-2 flex-none tabular-nums">
            {fmt(currentTime)} / {fmt(duration)}
          </span>
        </div>
        <input
          type="range"
          aria-label="Position im Song"
          min={0}
          max={duration || 1}
          step={0.1}
          value={Math.min(currentTime, duration || 1)}
          onPointerDown={beginSeek}
          onPointerUp={(e) => commitSeek(Number(e.currentTarget.value))}
          onPointerCancel={(e) => commitSeek(Number(e.currentTarget.value))}
          onLostPointerCapture={(e) => commitSeek(Number(e.currentTarget.value))}
          onKeyDown={(e) => {
            if (SEEK_KEYS.has(e.key) && !e.repeat) beginSeek();
          }}
          onKeyUp={(e) => {
            if (SEEK_KEYS.has(e.key)) commitSeek(Number(e.currentTarget.value));
          }}
          onBlur={(e) => commitSeek(Number(e.currentTarget.value))}
          onChange={(e) => {
            const seconds = Number(e.currentTarget.value);
            if (!seekActive.current) {
              beginSeek();
              onSeekPreview(seconds);
              commitSeek(seconds);
              return;
            }
            onSeekPreview(seconds);
          }}
          className="mt-1 w-full accent-ink"
        />
      </div>
    </div>
  );
}
