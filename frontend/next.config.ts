import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/api/media/offers": ["./data/media/pasionaria_media_catalog_2026-11-03.json"],
  },
};

export default nextConfig;
