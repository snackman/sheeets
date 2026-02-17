import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: '/data',
        destination: 'https://docs.google.com/spreadsheets/d/1xWmIHyEyOmPHfkYuZkucPRlLGWbb9CF6Oqvfl8FUV6k/edit?gid=377806756#gid=377806756',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
