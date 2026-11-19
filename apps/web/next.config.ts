import type { NextConfig } from "next";

// The browser calls the agent service through this same origin (/agent/*),
// so the screen works from any machine (e.g. through a tunnel) and only
// port 3000 needs to be exposed. AGENT_BACKEND is where Next forwards to.
const AGENT_BACKEND = process.env.AGENT_BACKEND || "http://localhost:8103";

const nextConfig: NextConfig = {
  // Lets a second dev server (e.g. a mock-mode copy on another port) run
  // beside the main one without sharing build output.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Streaming (SSE) responses must not be gzipped/buffered by the proxy.
  compress: false,
  // Demo reset recommits the graph root (~35 s); the default 30 s proxy timeout cut it off.
  experimental: { proxyTimeout: 180_000 },
  async rewrites() {
    return [{ source: "/agent/:path*", destination: `${AGENT_BACKEND}/:path*` }];
  },
};

export default nextConfig;
