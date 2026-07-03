import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
