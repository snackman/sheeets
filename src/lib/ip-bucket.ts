import net from 'node:net';

/** Expand a (possibly `::`-compressed) IPv6 address into its 8 hex groups,
 *  or null if it doesn't parse as one. Zone ids (`%eth0`) are stripped
 *  first. Doesn't bother resolving an IPv4-mapped tail (`::ffff:1.2.3.4`)
 *  into a single group — fine for rate-limit BUCKETING (not a security
 *  boundary like `safe-fetch.ts`'s IP classification), since that still
 *  produces a stable, consistent key for the same address. */
function expandIPv6Groups(ip: string): string[] | null {
  const addr = ip.split('%')[0];
  const parts = addr.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':').filter(Boolean) : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':').filter(Boolean) : [];
  let groups: string[];
  if (parts.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array(fill).fill('0'), ...tail];
  } else {
    groups = head;
  }
  return groups.length === 8 ? groups : null;
}

/** Bucket a client IP for rate-limit purposes (review finding, HIGH item
 *  2): an IPv4 address is used as-is, but an IPv6 address is reduced to
 *  its /64 prefix first — a single residential/mobile customer is
 *  typically handed a whole /64 (or larger) and can cycle through
 *  addresses within it per-request, so limiting by the FULL address would
 *  be trivially bypassable. Returns the ORIGINAL ip unchanged if it
 *  doesn't parse as IPv4/IPv6 at all (e.g. the 'unknown' sentinel). */
export function bucketIp(ip: string): string {
  if (net.isIP(ip) === 6) {
    const groups = expandIPv6Groups(ip);
    if (groups) return `v6:${groups.slice(0, 4).join(':')}::/64`;
  }
  return ip;
}
