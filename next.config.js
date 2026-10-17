/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Renamed makers keep their old addresses working (links already shared).
  async redirects() {
    return [{ source: "/makers/mol-oshima", destination: "/makers/mol-wind-challenger", permanent: true }];
  },
};

module.exports = nextConfig;
