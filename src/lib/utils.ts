export function parseDateToISO(dateStr: string): string {
  if (!dateStr) return '';
  const months: Record<string, string> = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
    'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
    'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12',
  };
  const match = dateStr.match(/(\w+)\s+(\d+)/);
  if (!match) return '';
  const month = months[match[1]] || months[dateStr.split(',')[1]?.trim().split(' ')[0]];
  if (!month) return '';
  const day = match[2].padStart(2, '0');
  return `2025-${month}-${day}`;
}

export function parseTimeToHour(timeStr: string): number | null {
  if (!timeStr) return null;
  const normalized = timeStr.toLowerCase().trim();
  if (normalized === 'all day' || normalized === 'tbd') return null;

  const match = normalized.match(/(\d{1,2}):?(\d{2})?\s*(am?|pm?)?/i);
  if (!match) return null;

  let hour = parseInt(match[1]);
  const isPM = match[3] && match[3].startsWith('p');
  const isAM = match[3] && match[3].startsWith('a');

  if (isPM && hour !== 12) hour += 12;
  if (isAM && hour === 12) hour = 0;

  return hour;
}

export function getTimeOfDay(timeStr: string): 'morning' | 'afternoon' | 'evening' | 'night' | 'all-day' {
  const hour = parseTimeToHour(timeStr);
  if (hour === null) return 'all-day';
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

export function isFreeEvent(cost: string): boolean {
  if (!cost) return true;
  const lower = cost.toLowerCase().trim();
  return lower === 'free' || lower === '' || lower === '0' || lower === '$0';
}

export function normalizeAddress(address: string): string {
  return address.toLowerCase().trim().replace(/\s+/g, ' ');
}

export function formatDateLabel(isoDate: string): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = new Date(isoDate + 'T12:00:00');
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
}
