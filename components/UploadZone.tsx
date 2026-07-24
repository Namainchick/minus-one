"use client";

import { useRef, useState } from "react";

type Props = {
  onFile: (file: File) => void;
  onDemo: () => void;
};

export function UploadZone({ onFile, onDemo }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div className="mt-8 flex flex-col gap-4 sm:flex-row">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) onFile(file);
        }}
        className={`flex-[2] border-[3px] border-dashed border-ink p-8 text-center transition-colors ${
          dragging ? "bg-poster-yellow" : "bg-white"
        }`}
      >
        <span className="block text-base font-bold uppercase">MP3, WAV oder M4A hier reinwerfen</span>
        <span className="mt-1 block text-xs text-neutral-500">
          max. 15 MB · max. 7 Minuten · dauert ~1 Minute
        </span>
        <input
          ref={inputRef}
          type="file"
          accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4,audio/x-m4a"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = "";
          }}
        />
      </button>

      <button
        type="button"
        onClick={onDemo}
        className="flex-1 border-[3px] border-ink bg-poster-red p-8 text-center text-sm font-bold uppercase text-white shadow-poster-lg transition-transform active:translate-x-1 active:translate-y-1 active:shadow-none"
      >
        Keine Lust zu warten?
        <br />
        Demo-Song laden →
      </button>
    </div>
  );
}
