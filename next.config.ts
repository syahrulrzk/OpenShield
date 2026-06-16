import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // serverActions are default in Next 16
  },
  // We handle security headers in src/proxy.ts
};

export default nextConfig;
