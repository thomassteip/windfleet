// Anything named NEXT_PUBLIC_* is copied into the browser bundle, where every
// visitor can read it. The Supabase service key can write and delete, so stop
// the build outright if one ever lands under such a name. It belongs in
// SUPABASE_SERVICE_KEY, read only by app/api/vessels/route.js.
const isSecretSupabaseKey = (v) => {
  if (v.startsWith("sb_secret_")) return true; // new-style secret key
  try {
    // Legacy keys are JWTs; the service key's payload says role "service_role".
    const payload = JSON.parse(Buffer.from(v.split(".")[1], "base64url").toString());
    return payload.role === "service_role";
  } catch {
    return false;
  }
};
for (const [name, value] of Object.entries(process.env)) {
  if (name.startsWith("NEXT_PUBLIC_") && value && isSecretSupabaseKey(value)) {
    throw new Error(`${name} holds a Supabase secret key. Rename it SUPABASE_SERVICE_KEY: NEXT_PUBLIC_ values are sent to every browser.`);
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Renamed makers keep their old addresses working (links already shared).
  async redirects() {
    return [{ source: "/makers/mol-oshima", destination: "/makers/mol-wind-challenger", permanent: true }];
  },
};

module.exports = nextConfig;
