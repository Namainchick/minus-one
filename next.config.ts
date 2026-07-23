import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lokaler Demucs-Modus nutzt dynamische fs-Pfade; ohne Excludes zieht das
  // File-Tracing sonst das halbe Repo in die Serverless-Funktionen.
  outputFileTracingExcludes: {
    "*": ["./public/demo/**", "./e2e/**", "./tests/**", "./docs/**", "./scripts/**", "./.superpowers/**"],
  },
};

export default nextConfig;
