import { Redis } from "@upstash/redis";

/** Zähler-Abstraktion: Upstash in Produktion, Memory lokal/im Test. */
export interface Counter {
  incr(key: string, ttlSeconds: number): Promise<number>;
}

export class MemoryCounter implements Counter {
  private store = new Map<string, { value: number; expiresAt: number }>();
  async incr(key: string, ttlSeconds: number): Promise<number> {
    const now = Date.now();
    const entry = this.store.get(key);
    if (!entry || entry.expiresAt < now) {
      this.store.set(key, { value: 1, expiresAt: now + ttlSeconds * 1000 });
      return 1;
    }
    entry.value += 1;
    return entry.value;
  }
}

export class RedisCounter implements Counter {
  constructor(private redis: Redis) {}
  async incr(key: string, ttlSeconds: number): Promise<number> {
    const value = await this.redis.incr(key);
    if (value === 1) await this.redis.expire(key, ttlSeconds);
    return value;
  }
}

let defaultInstance: Counter | null = null;

/** In Produktion Pflicht: Upstash-Env-Vars. Ohne sie: In-Memory (nur Dev/E2E). */
export function defaultCounter(): Counter {
  if (defaultInstance) return defaultInstance;
  // Klassische Upstash-Namen oder die KV_*-Namen der Vercel-Marketplace-Integration.
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (url && token) {
    defaultInstance = new RedisCounter(new Redis({ url, token }));
  } else {
    if (process.env.VERCEL_ENV === "production") {
      throw new Error(
        "Upstash env vars are missing in production — rate limit and daily budget would have no effect. Check the deployment configuration.",
      );
    }
    defaultInstance = new MemoryCounter();
  }
  return defaultInstance;
}

export const RATE_LIMIT_PER_HOUR = 3;
export const UPLOAD_TOKEN_LIMIT_PER_HOUR = 6;

function hourBucket(now: Date): string {
  return now.toISOString().slice(0, 13); // "2026-07-23T10"
}
function dayBucket(now: Date): string {
  return now.toISOString().slice(0, 10); // "2026-07-23"
}

/** true = darf weitermachen. Verbraucht einen Zähler-Slot. */
export async function checkRateLimit(counter: Counter, ip: string, now = new Date()): Promise<boolean> {
  const n = await counter.incr(`rl:${ip}:${hourBucket(now)}`, 3700);
  return n <= RATE_LIMIT_PER_HOUR;
}

/** Großzügigeres Limit für die Token-Ausgabe (Vorstufe vor dem Upload). */
export async function checkUploadTokenLimit(counter: Counter, ip: string, now = new Date()): Promise<boolean> {
  const n = await counter.incr(`ul:${ip}:${hourBucket(now)}`, 3700);
  return n <= UPLOAD_TOKEN_LIMIT_PER_HOUR;
}

export function dailyLimit(): number {
  return Number(process.env.DAILY_SEPARATION_LIMIT ?? 20);
}

/** true = Budget vorhanden (und verbraucht einen Slot). */
export async function consumeDailyBudget(counter: Counter, now = new Date()): Promise<boolean> {
  const n = await counter.incr(`budget:${dayBucket(now)}`, 172800);
  return n <= dailyLimit();
}
