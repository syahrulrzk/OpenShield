import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Native Node modules that use CommonJS — exclude from Turbopack bundling
  // and load via require() at runtime
  serverExternalPackages: ["ssh2", "pg", "mysql2", "mssql"],
  // We handle security headers in src/proxy.ts
  // Allow LAN/Cloudflare hosts for dev HMR + devtools
  allowedDevOrigins: [
    "172.16.19.235",
    "localhost",
    "127.0.0.1",
    "103.245.16.18", // public IP for Cloudflare tunnel testing
  ],
};

export default nextConfig;
