"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { ChannelStrip } from "@/components/ChannelStrip";
import { Transport } from "@/components/Transport";
import type { MultiTrackPlayer } from "@/lib/audio-engine";
import { STEMS } from "@/lib/stems";

type Props = { engine: MultiTrackPlayer; title: string };

export function PlayerView({ engine, title }: Props) {
  // Engine ist die Quelle der Wahrheit; forceUpdate spiegelt sie ins UI.
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const [time, setTime] = useState(0);
  const [previewTime, setPreviewTime] = useState<number | null>(null);
  const seekRequestRef = useRef(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTime(engine.currentTime), 250);
    return () => window.clearInterval(timer);
  }, [engine]);

  return (
    <div className="mt-10">
      <Transport
        title={title}
        playing={engine.playing}
        currentTime={previewTime ?? time}
        duration={engine.duration}
        onPlayPause={() => {
          if (engine.playing) {
            engine.pause();
            forceUpdate();
          } else {
            engine
              .play()
              .catch(() => {
                // Engine hat sich selbst pausiert — UI-Zustand nachziehen.
              })
              .finally(() => forceUpdate());
          }
        }}
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
            .catch(() => {
              // Engine hält nach einem Seek-Fehler alle Spuren konsistent pausiert.
            })
            .finally(() => {
              if (seekRequestRef.current !== request) return;
              setPreviewTime(null);
              setTime(engine.currentTime);
              forceUpdate();
            });
        }}
      />

      <div className="mt-6 grid grid-cols-3 gap-3 sm:grid-cols-6">
        {STEMS.map((stem) => (
          <ChannelStrip
            key={stem}
            stem={stem}
            enabled={engine.isEnabled(stem)}
            volume={engine.getVolume(stem)}
            onToggle={() => {
              engine.setEnabled(stem, !engine.isEnabled(stem));
              forceUpdate();
            }}
            onVolume={(v) => {
              engine.setVolume(stem, v);
              forceUpdate();
            }}
          />
        ))}
      </div>

      <p className="mt-4 text-xs text-neutral-500">
        Switch = instrument on/off · Fader = volume · Off means: you play it yourself
      </p>
    </div>
  );
}
