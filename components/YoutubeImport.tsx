"use client";

import { useState } from "react";

type Props = { onImport: (url: string) => void };

export function YoutubeImport({ onImport }: Props) {
  const [url, setUrl] = useState("");

  return (
    <form
      className="mt-4 flex flex-col gap-3 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        if (url.trim()) onImport(url.trim());
      }}
    >
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://www.youtube.com/watch?v=…"
        aria-label="YouTube link"
        className="flex-[2] border-[3px] border-ink bg-white px-4 py-3 text-sm font-medium placeholder:text-neutral-400 focus:outline-none"
      />
      <button
        type="submit"
        className="flex-1 border-[3px] border-ink bg-poster-yellow px-4 py-3 text-sm font-bold uppercase shadow-poster transition-transform active:translate-x-1 active:translate-y-1 active:shadow-none"
      >
        Von YouTube holen
      </button>
    </form>
  );
}
