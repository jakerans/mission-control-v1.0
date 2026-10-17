import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Project icon uploads are up to 2MB, plus multipart overhead
    serverActions: { bodySizeLimit: "3mb" },
  },
};

export default nextConfig;
