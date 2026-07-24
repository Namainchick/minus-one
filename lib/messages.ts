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
    title: "ZU GROSS",
    text: "Die Datei ist größer als 15 MB. Exportier den Song kleiner — 192 kbit/s MP3 reicht völlig.",
  },
  bad_format: {
    title: "FALSCHES FORMAT",
    text: "Nur MP3, WAV oder M4A. Andere Formate versteht die Bühne hier nicht.",
  },
  too_long: {
    title: "ZU LANG",
    text: "Maximal 7 Minuten. Prog-Rock-Epen bitte in zwei Teilen.",
  },
  rate_limited: {
    title: "KURZE PAUSE",
    text: "Mehr als 3 Songs pro Stunde sind nicht drin — die GPU braucht auch mal Ruhe. Probier solange den Demo-Song.",
  },
  budget_exhausted: {
    title: "TAGESBUDGET AUFGEBRAUCHT",
    text: "Für heute sind alle Trennungen verbraucht. Morgen geht es weiter — der Demo-Song läuft immer.",
  },
  processing_failed: {
    title: "DA IST WAS SCHIEFGELAUFEN",
    text: "Die Trennung ist fehlgeschlagen. Versuch es nochmal — oder nimm den Demo-Song.",
  },
  youtube_failed: {
    title: "YOUTUBE STREIKT",
    text: "Das Video ließ sich nicht laden. Prüf den Link — oder lad die Datei direkt hoch.",
  },
  network: {
    title: "VERBINDUNG WEG",
    text: "Das Laden hat nicht geklappt. Einmal neu versuchen?",
  },
};

export const PROCESSING_LINES = [
  "Sänger wird vom Mikro getrennt…",
  "Isoliere den Schlagzeuger…",
  "Bassist wird gesucht (wie immer)…",
  "Gitarrenkabel werden entwirrt…",
  "Klavierdeckel wird angehoben…",
  "Der Rest der Band packt zusammen…",
];
