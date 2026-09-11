export type ErrorCode =
  | "too_large"
  | "bad_format"
  | "too_long"
  | "rate_limited"
  | "budget_exhausted"
  | "processing_failed"
  | "youtube_failed"
  | "network";

export const ERROR_MESSAGES: Record<ErrorCode, { title: string; text: string }> = {
  too_large: {
    title: "TOO BIG",
    text: "The file is bigger than 15 MB. Export the song smaller, 192 kbit/s MP3 is plenty.",
  },
  bad_format: {
    title: "WRONG FORMAT",
    text: "MP3, WAV or M4A only. The stage doesn't speak other formats.",
  },
  too_long: {
    title: "TOO LONG",
    text: "7 minutes max. Prog-rock epics in two parts, please.",
  },
  rate_limited: {
    title: "SHORT BREAK",
    text: "More than 3 songs per hour won't fly, the GPU needs a break too. Try the demo song in the meantime.",
  },
  budget_exhausted: {
    title: "DAILY BUDGET USED UP",
    text: "All separations for today are used up. Back tomorrow. The demo song always works.",
  },
  processing_failed: {
    title: "SOMETHING WENT WRONG",
    text: "The separation failed. Try again, or take the demo song.",
  },
  youtube_failed: {
    title: "YOUTUBE IS SULKING",
    text: "The video wouldn't load. Check the link, or upload the file directly.",
  },
  network: {
    title: "CONNECTION LOST",
    text: "Loading didn't work. Try once more?",
  },
};

export const PROCESSING_LINES = [
  "Unplugging the singer's mic…",
  "Isolating the drummer…",
  "Looking for the bassist (as usual)…",
  "Untangling the guitar cables…",
  "Lifting the piano lid…",
  "The rest of the band is packing up…",
];
