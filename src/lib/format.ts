/** 1234567.8 → "1.23M", 12345 → "12.3K", 999 → "999". */
export function compact(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '∞';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}${trim((abs / 1e9).toFixed(digits))}B`;
  if (abs >= 1e6) return `${sign}${trim((abs / 1e6).toFixed(digits))}M`;
  if (abs >= 1e4) return `${sign}${trim((abs / 1e3).toFixed(1))}K`;
  if (abs >= 100) return `${sign}${Math.round(abs).toLocaleString('en-US')}`;
  return `${sign}${trim(abs.toFixed(1))}`;
}

const trim = (s: string) => s.replace(/\.0+$|(\.\d*?)0+$/, '$1');

/** Exact coin amount with thousands separators and one decimal, e.g. "1,275.9". */
export function coins(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  return n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function integer(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  return Math.round(n).toLocaleString('en-US');
}

export function pct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '∞';
  return `${n.toFixed(digits)}%`;
}

/** Hours → "3m", "1.5h", "2d 4h". */
export function duration(hours: number, lang: 'ko' | 'en' = 'ko'): string {
  if (!Number.isFinite(hours)) return '∞';
  const u = lang === 'ko' ? { m: '분', h: '시간', d: '일' } : { m: 'm', h: 'h', d: 'd' };
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}${u.m}`;
  if (hours < 24) return `${trim(hours.toFixed(1))}${u.h}`;
  const days = Math.floor(hours / 24);
  const rem = Math.round(hours - days * 24);
  return rem > 0 ? `${days}${u.d} ${rem}${u.h}` : `${days}${u.d}`;
}

/** Seconds → "12초 전" / "12s ago". */
export function ago(seconds: number, lang: 'ko' | 'en' = 'ko'): string {
  const s = Math.max(0, Math.floor(seconds));
  if (lang === 'ko') return s < 60 ? `${s}초 전` : `${Math.floor(s / 60)}분 전`;
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}

/** Parse user input like "10m", "1.5k", "2b", "1,000,000" into a number. */
export function parseCoins(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, '');
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2] as 'k' | 'm' | 'b'] ?? 1;
  return Number(m[1]) * mult;
}
