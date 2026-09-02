import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [],
  },
  serverExternalPackages: ["sharp", "@vladmandic/human"],
};

export default nextConfig;
