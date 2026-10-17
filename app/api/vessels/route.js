import { NextResponse } from "next/server";

// The one place the app reads the fleet from Supabase. The `vessels` table has
// no public read policy (Oct 2026), so the browser can't query it directly any
// more: it asks this route, which reads with the service key and decides which
// columns leave the server.
//
// The service key can write and delete. It lives only in SUPABASE_SERVICE_KEY
// (no NEXT_PUBLIC_ prefix, so Next never copies it into the browser bundle),
// and only in this file: a route file can't be imported by client code.
// next.config.js refuses to build if a secret key turns up under a public name.

// Run on every request rather than once at build time, which would freeze the
// fleet into the deploy. Vercel's CDN caches the response instead (below).
export const dynamic = "force-dynamic";

// Served from Vercel's cache for an hour, then refreshed in the background, so
// Supabase sees about one request an hour however busy the site is. Positions
// only change once a day, and a fresh init.sql paste shows within the hour.
const CACHED = { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" };
// Failures are never cached: the next visitor tries again. The app falls back
// to the bundled snapshot meanwhile (lib/data.js).
const UNCACHED = { "Cache-Control": "no-store" };

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

// New sb_secret_ keys go on the apikey header only: sent as a Bearer token
// they're rejected as an invalid JWT. Legacy service_role JWTs also go as Bearer.
const headers = serviceKey && {
  apikey: serviceKey,
  ...(serviceKey.startsWith("sb_") ? {} : { Authorization: `Bearer ${serviceKey}` }),
};

export async function GET() {
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Supabase is not configured" }, { status: 503, headers: UNCACHED });
  }
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/vessels?select=*&order=id`, {
      headers,
      cache: "no-store",
    });
    const data = res.ok ? await res.json() : null;
    // A key without read access gets an empty list, not an error.
    if (!Array.isArray(data) || data.length === 0) {
      return NextResponse.json({ error: "Fleet unavailable" }, { status: 502, headers: UNCACHED });
    }
    // Notes are internal working notes (sourcing, corrections). Only whether
    // they flag the row as VERIFY is public, so that's all that goes out.
    const rows = data.map(({ notes, updated_at, ...r }) => ({
      ...r,
      needs_verify: /VERIFY/.test(notes || ""),
    }));
    return NextResponse.json(rows, { headers: CACHED });
  } catch {
    return NextResponse.json({ error: "Fleet unavailable" }, { status: 502, headers: UNCACHED });
  }
}
