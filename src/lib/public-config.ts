/**
 * Config keys the public site reads (sponsors/ads/upsell copy). Everything
 * else -- notably `conferences` (which includes manually hidden ones) and
 * the full `ab_tests` list -- is admin-only (the public gets a sanitized `ab_tests`, see `sanitizePublicConfigValue`). Per-conference keys use a `<key>:<conference>`
 * form, matched by prefix.
 */
const PUBLIC_CONFIG_KEYS = new Set(['sponsors', 'sponsors_cta', 'native_ads', 'upsell_copy', 'profile_ad', 'ab_tests']);
const PUBLIC_CONFIG_PREFIXES = ['advertise_page', 'ad_inventory', 'theme'];

export function isPublicConfigKey(key: string): boolean {
  if (PUBLIC_CONFIG_KEYS.has(key)) return true;
  return PUBLIC_CONFIG_PREFIXES.some((p) => key === p || key.startsWith(`${p}:`));
}

/**
 * Public view of a config value. `ab_tests` is reduced to running tests and
 * only the fields the client needs to assign/render a variant (no
 * descriptions, winners, timestamps or other internal fields).
 */
export function sanitizePublicConfigValue(key: string, value: unknown): unknown {
  if (key !== 'ab_tests') return value;
  if (!Array.isArray(value)) return [];
  return value
    .filter((t) => t && typeof t === 'object' && (t as { status?: unknown }).status === 'running')
    .map((t) => {
      const test = t as Record<string, unknown>;
      const variants = Array.isArray(test.variants) ? test.variants : [];
      return {
        id: test.id,
        name: test.name,
        status: test.status,
        placement: test.placement,
        conference: test.conference ?? '',
        variants: variants.map((v) => {
          const variant = v as Record<string, unknown>;
          return { id: variant.id, name: variant.name, weight: variant.weight, config: variant.config ?? {} };
        }),
      };
    });
}
