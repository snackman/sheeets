import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/avatars/**',
      },
      {
        protocol: 'https',
        hostname: 'unavatar.io',
      },
    ],
  },
  async redirects() {
    return [
      {
        source: '/data',
        destination: 'https://docs.google.com/spreadsheets/d/1xWmIHyEyOmPHfkYuZkucPRlLGWbb9CF6Oqvfl8FUV6k/edit?gid=377806756#gid=377806756',
        permanent: false,
      },
      {
        source: '/miami',
        destination: '/consensus',
        permanent: false,
      },
      {
        source: '/nyc',
        destination: '/nytechweek',
        permanent: false,
      },
      {
        source: '/toronto',
        destination: '/ttw',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
