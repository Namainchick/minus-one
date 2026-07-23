export const STEMS = ["vocals", "drums", "bass", "guitar", "piano", "other"] as const;
export type StemName = (typeof STEMS)[number];

export const STEM_LABELS: Record<StemName, string> = {
  vocals: "GESANG",
  drums: "DRUMS",
  bass: "BASS",
  guitar: "GITARRE",
  piano: "KLAVIER",
  other: "REST",
};

export const STEM_COLORS: Record<StemName, string> = {
  vocals: "#ff4911",
  drums: "#ffde00",
  bass: "#3ec6e0",
  guitar: "#2ecc71",
  piano: "#a78bfa",
  other: "#3b82f6",
};

export const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_DURATION_SECONDS = 7 * 60; // 7 Minuten
