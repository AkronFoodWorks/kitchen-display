// Kitchen schedule relay for the TV display.
//
// The Food Corridor schedule endpoint is public but can't be read from a
// browser on another site, so the TV page calls this function instead.
// It fetches yesterday/today/tomorrow, saves the copy to
// kitchen_schedule_cache, and returns it. If Food Corridor is down it
// returns the last saved copy marked stale. Each successful refresh is
// a database write, which also keeps the free Supabase project active.
//
// Deploy with JWT verification OFF (the TV calls it without signing in).
// It only ever reads/writes kitchen_schedule_cache — never member data.

import { createClient } from "jsr:@supabase/supabase-js@2";

const LISTING = "7542-akron-food-works";
const GANTT_URL = `https://app.thefoodcorridor.com/listings/${LISTING}/tfc_calendars/ganttdata`;
const TZ = "America/New_York";
const REUSE_FOR_MS = 60_000; // several TVs polling share one Food Corridor fetch per minute
const HOUR = 3_600_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

type Booking = { startDate: number; endDate: number; calendar: string; title: string; color: string };

// ---- Akron-time helpers -------------------------------------------------
const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hourCycle: "h23",
  year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
});
function parts(ms: number) {
  const p: Record<string, string> = {};
  for (const x of partsFmt.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute };
}
function midnightOf(ms: number): number {
  const p = parts(ms);
  const guess = Date.UTC(p.y, p.m - 1, p.d);
  const g = parts(guess);
  const offset = Date.UTC(g.y, g.m - 1, g.d, g.h, g.mi) - guess;
  return guess - offset;
}

// ---- Food Corridor ------------------------------------------------------
async function fetchDay(midnightMs: number): Promise<Booking[]> {
  const url = `${GANTT_URL}?date=${Math.floor(midnightMs / 1000)}`;
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (kitchen-display-bot/1.0)", Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Food Corridor HTTP ${r.status}`);
  const data = await r.json();
  if (!Array.isArray(data)) throw new Error("Food Corridor returned an unexpected shape");
  return data;
}

async function fetchSchedule(): Promise<Booking[]> {
  const today = midnightOf(Date.now());
  const days = [midnightOf(today - 12 * HOUR), today, midnightOf(today + 36 * HOUR)];
  const lists = await Promise.all(days.map(fetchDay));
  const keepFrom = days[0], keepTo = days[2] + 24 * HOUR;
  const seen = new Set<string>();
  const out: Booking[] = [];
  for (const list of lists) {
    for (const b of list) {
      const resourceRow = !b.title;
      if (!resourceRow && (b.endDate < keepFrom || b.startDate > keepTo)) continue;
      const key = resourceRow ? `res|${b.calendar}` : `${b.calendar}|${b.title}|${b.startDate}|${b.endDate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ startDate: b.startDate, endDate: b.endDate, calendar: b.calendar, title: b.title, color: b.color });
    }
  }
  return out;
}

// ---- handler ------------------------------------------------------------
function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") return reply({ error: "GET only" }, 405);

  const { data: cached } = await db
    .from("kitchen_schedule_cache")
    .select("payload, fetched_at")
    .eq("id", 1)
    .maybeSingle();

  if (cached && Date.now() - Date.parse(cached.fetched_at) < REUSE_FOR_MS) {
    return reply({ fetched_at: cached.fetched_at, stale: false, bookings: cached.payload });
  }

  try {
    const bookings = await fetchSchedule();
    const fetched_at = new Date().toISOString();
    const { error } = await db
      .from("kitchen_schedule_cache")
      .upsert({ id: 1, payload: bookings, fetched_at });
    if (error) console.error("cache write failed:", error.message);
    return reply({ fetched_at, stale: false, bookings });
  } catch (e) {
    console.error("refresh failed:", e instanceof Error ? e.message : e);
    if (cached) return reply({ fetched_at: cached.fetched_at, stale: true, bookings: cached.payload });
    return reply({ error: "Schedule unavailable" }, 502);
  }
});
