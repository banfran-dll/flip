import type { Crash } from './aggregate';

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });

export async function postCrashAlerts(webhook: string, crashes: Crash[], siteUrl?: string): Promise<void> {
  if (crashes.length === 0) return;
  const lines = crashes.slice(0, 10).map((c) => `• **${c.id}** −${c.dropPct.toFixed(1)}% · now ${fmt(c.now)} / 24h ${fmt(c.baseline)} · 24h trades ${fmt(c.trades24)}`);
  const content = [`📉 **Bazaar crash${crashes.length > 1 ? 'es' : ''}** (${crashes.length})`, ...lines, siteUrl ? `${siteUrl}` : ''].filter(Boolean).join('\n');
  await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}
