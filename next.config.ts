import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // libpg-query loads its PostgreSQL parser from a sibling .wasm file at runtime.
  serverExternalPackages: ["libpg-query"],
  outputFileTracingIncludes: {
    "/api/config/database/initialize": [
      "./data/hkex/hkex-short-selling.csv",
      "./data/hkex/hkex-coverage.json",
    ],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
