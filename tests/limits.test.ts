import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryCounter, checkRateLimit, consumeDailyBudget, RATE_LIMIT_PER_HOUR } from "@/lib/limits";

const NOW = new Date("2026-07-23T10:00:00Z");

afterEach(() => {
  delete process.env.DAILY_SEPARATION_LIMIT;
  delete process.env.VERCEL_ENV;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
});

describe("checkRateLimit", () => {
  it("erlaubt die ersten 3 Anfragen pro IP und Stunde, blockt die vierte", async () => {
    const c = new MemoryCounter();
    for (let i = 0; i < RATE_LIMIT_PER_HOUR; i++) {
      expect(await checkRateLimit(c, "1.2.3.4", NOW)).toBe(true);
    }
    expect(await checkRateLimit(c, "1.2.3.4", NOW)).toBe(false);
  });

  it("zählt IPs getrennt", async () => {
    const c = new MemoryCounter();
    for (let i = 0; i < RATE_LIMIT_PER_HOUR; i++) await checkRateLimit(c, "1.2.3.4", NOW);
    expect(await checkRateLimit(c, "5.6.7.8", NOW)).toBe(true);
  });

  it("beginnt in der nächsten Stunde neu", async () => {
    const c = new MemoryCounter();
    for (let i = 0; i < RATE_LIMIT_PER_HOUR; i++) await checkRateLimit(c, "1.2.3.4", NOW);
    const nextHour = new Date("2026-07-23T11:00:01Z");
    expect(await checkRateLimit(c, "1.2.3.4", nextHour)).toBe(true);
  });
});

describe("consumeDailyBudget", () => {
  it("erlaubt bis zum Limit und blockt danach", async () => {
    process.env.DAILY_SEPARATION_LIMIT = "2";
    const c = new MemoryCounter();
    expect(await consumeDailyBudget(c, NOW)).toBe(true);
    expect(await consumeDailyBudget(c, NOW)).toBe(true);
    expect(await consumeDailyBudget(c, NOW)).toBe(false);
  });

  it("nutzt 20 als Default-Limit", async () => {
    const c = new MemoryCounter();
    for (let i = 0; i < 20; i++) expect(await consumeDailyBudget(c, NOW)).toBe(true);
    expect(await consumeDailyBudget(c, NOW)).toBe(false);
  });
});

describe("defaultCounter", () => {
  it("wirft in Produktion ohne Upstash-Env-Vars", async () => {
    vi.resetModules();
    process.env.VERCEL_ENV = "production";
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const { defaultCounter } = await import("@/lib/limits");
    expect(() => defaultCounter()).toThrow(/Upstash/);
  });

  it("akzeptiert die klassischen Upstash-Variablennamen", async () => {
    vi.resetModules();
    process.env.VERCEL_ENV = "production";
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    const { defaultCounter, RedisCounter } = await import("@/lib/limits");
    expect(defaultCounter()).toBeInstanceOf(RedisCounter);
  });

  it("akzeptiert die KV-Variablennamen der Vercel-Marketplace-Integration", async () => {
    vi.resetModules();
    process.env.VERCEL_ENV = "production";
    process.env.KV_REST_API_URL = "https://example.upstash.io";
    process.env.KV_REST_API_TOKEN = "token";
    const { defaultCounter, RedisCounter } = await import("@/lib/limits");
    expect(defaultCounter()).toBeInstanceOf(RedisCounter);
  });
});
