import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Multipart overhead sits above the 10 MB proof limit enforced by the action and bucket.
    serverActions: { bodySizeLimit: "11mb" },
  },
  async redirects() {
    return [
      {
        source: "/unit/:slug*",
        destination: "/s/hidroloji/unit/:slug*",
        permanent: true,
      },
      {
        source: "/q/:id",
        destination: "/s/hidroloji/q/:id",
        permanent: true,
      },
      {
        source: "/formulas",
        destination: "/s/hidroloji/formulas",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
