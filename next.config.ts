import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Native Node modules that use CommonJS — exclude from Turbopack bundling
  // and load via require() at runtime
  serverExternalPackages: ["ssh2", "pg", "mysql2", "mssql"],
  // We handle security headers in src/proxy.ts
};

export default nextConfig;
