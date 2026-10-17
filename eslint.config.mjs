import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// NOTE: package.json pins eslint-plugin-react-hooks to 7.0.1 via
// `overrides` (eslint-config-next@16.4.2 would otherwise pull 7.1.x). The
// 7.1 release made several React Compiler rules (set-state-in-effect,
// refs, preserve-manual-memoization, ...) fire on long-standing,
// intentional patterns across ~20 files (e.g. `setLoading(true);
// fetch().then(...)` in a mount effect) with no actual bug involved.
// Revisit this pin -- and decide whether to refactor those call sites or
// adjust rule severity -- as a separate, deliberate pass.
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Event flyers/avatars are hot-linked from arbitrary third-party hosts
      // (Luma, Google, Twitter CDNs, ...), so next/image's remotePatterns
      // allow-list and optimizer don't fit. Plain <img> is intentional.
      "@next/next/no-img-element": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Gitignored local one-off script (may exist in some checkouts).
    "scripts/migrate-itinerary-ids.ts",
  ]),
]);

export default eslintConfig;
