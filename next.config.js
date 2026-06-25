/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep searoute-js (and its marine-network data) on the server only — it does
  // not bundle cleanly for the browser. The /api/searoute route uses it.
  experimental: {
    serverComponentsExternalPackages: ["searoute-js"],
  },
};

module.exports = nextConfig;
