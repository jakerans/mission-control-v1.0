import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The Agent SDK launches its bundled Claude Code binary; load it with Node's require, unbundled
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
  experimental: {
    // Project icon uploads are up to 2MB, plus multipart overhead
    serverActions: { bodySizeLimit: "3mb" },
  },
};

export default nextConfig;
