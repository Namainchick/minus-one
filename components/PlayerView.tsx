"use client";

import { useEffect, useReducer, useState } from "react";
import { ChannelStrip } from "@/components/ChannelStrip";
import { Transport } from "@/components/Transport";
import type { MultiTrackPlayer } from "@/lib/audio-engine";
import { STEMS } from "@/lib/stems";

type Props = { engine: MultiTrackPlayer; title: string };

export function PlayerView({ engine, title }: Props) {
  // Engine ist die Quelle der Wahrheit; forceUpdate spiegelt sie ins UI.
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const [time, setTime] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setTime(engine.currentTime), 250);
    return () => window.clearInterval(timer);
  }, [engine]);

  return (
    <div className="mt-10">
      <Transport
        title={title}
        playing={engine.playing}
        currentTime={time}
        duration={engine.duration}
        onPlayPause={() => {
          if (engine.playing) {
            engine.pause();
          } else {
            void engine.play();
          }
          forceUpdate();
        }}
        onSeek={(s) => {
          engine.seek(s);
          setTime(s);
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
        Schalter = Instrument an/aus · Fader = Lautstärke · Aus heißt: du spielst das selbst
      </p>
    </div>
  );
}
