import { createClient } from "@supabase/supabase-js";

// Public (anon) client — safe to expose in the browser. Reads only, gated by
// the row-level-security policy on the `vessels` table. If the env vars aren't
// set, `supabase` is null and the app falls back to the bundled snapshot.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = url && anonKey ? createClient(url, anonKey) : null;
