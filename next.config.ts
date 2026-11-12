import type { NextConfig } from "next";

// Content-Security-Policy.
//
// ENFORCED (`enforcedCsp`): the directives that never touch script/style
// loading -- no plugins/objects, <base> pinned to self, framing limited to
// same origin, form posts to self. These cannot break page scripts.
//
// REPORT-ONLY (`csp`): the full policy, including script-src. Violations are
// POSTed to /api/csp-report and logged as `[csp]` lines in Vercel logs.
// script-src still allows 'unsafe-inline' because Next's inline bootstrap /
// RSC payload scripts on the statically generated (ISR) pages carry no nonce
// and have per-page content (so no fixed hash). Dropping 'unsafe-inline'
// needs a per-request nonce via a proxy, which forces every page to render
// dynamically (losing static/ISR caching), so it is deferred.
const enforcedCsp = [
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
  "form-action 'self'",
].join('; ');

const csp = [
  "default-src 'self'",
  [
    "script-src 'self' 'unsafe-inline'",
    // Google Analytics (gtag) + Google Maps/Places + Google Identity Services
    'https://www.googletagmanager.com',
    'https://*.googletagmanager.com',
    'https://maps.googleapis.com',
    'https://accounts.google.com',
    // Chart.js on /admin/analytics
    'https://cdn.jsdelivr.net',
    // Vercel toolbar / analytics on preview deployments
    'https://vercel.live',
    // Cloudflare Turnstile widget script (Phase 3 host-submission page,
    // `SubmitSourceForm.tsx` — re-review finding F). Loaded even when
    // `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is unset in THIS environment, since
    // CSP is a static, build-time header, not conditional on runtime env
    // vars, and Snax may set the key later without a code change.
    'https://challenges.cloudflare.com',
  ].join(' '),
  [
    "connect-src 'self'",
    'https://*.supabase.co',
    'wss://*.supabase.co',
    'https://api.mapbox.com',
    'https://events.mapbox.com',
    'https://*.google-analytics.com',
    'https://*.analytics.google.com',
    'https://www.google.com',
    'https://*.googletagmanager.com',
    'https://maps.googleapis.com',
    'https://places.googleapis.com',
    'https://accounts.google.com',
    'https://www.googleapis.com',
    'https://cdn.jsdelivr.net',
    'https://vercel.live',
    'wss://ws-us3.pusher.com',
    // Cloudflare Turnstile (re-review finding F): the widget script makes
    // its own XHR/fetch calls back to challenges.cloudflare.com.
    'https://challenges.cloudflare.com',
  ].join(' '),
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com https://vercel.live",
  [
    "frame-src 'self'",
    'https://lu.ma',
    'https://luma.com',
    'https://*.luma.com',
    'https://accounts.google.com',
    'https://vercel.live',
    // Cloudflare Turnstile renders its challenge in an iframe
    // (re-review finding F).
    'https://challenges.cloudflare.com',
  ].join(' '),
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  'report-uri /api/csp-report',
  'report-to csp-endpoint',
].join('; ');

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
  async headers() {
    // Baseline security headers. The app is never embedded by third parties
    // (it only embeds Luma iframes itself), so SAMEORIGIN framing is safe.
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'geolocation=(self)' },
          { key: 'Reporting-Endpoints', value: 'csp-endpoint="/api/csp-report"' },
          { key: 'Content-Security-Policy', value: enforcedCsp },
          { key: 'Content-Security-Policy-Report-Only', value: csp },
        ],
      },
    ];
  },
  async redirects() {
    return [
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
      // Short aliases -> current-year conference slugs. Temporary (302) on
      // purpose: the targets change every year.
      { source: '/devcon', destination: '/devcon8', permanent: false },
      { source: '/breakpoint', destination: '/breakpoint2026', permanent: false },
      { source: '/solana', destination: '/breakpoint2026', permanent: false },
      { source: '/das', destination: '/daslondon2026', permanent: false },
      { source: '/daslondon', destination: '/daslondon2026', permanent: false },
    ];
  },
};

export default nextConfig;
