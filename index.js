// Token Risk Scanner: never trades. Tells a trading bot (or you) which tokens to stay away from.
//  1. Chord's scam screen: every token the chain's 24h board hides as scam / suspect, with the reason in words
//     (few wallets making the volume, wash, buyer clusters, rugs, a major's ticker on another address).
//  2. Your watch list (WATCH_TOKENS): screen status, a sell cascade on the hourly candles, and on chains with
//     Chord's LP index (Monad, Robinhood, Arc) liquidity pulled in the last 24 hours.
//  3. On those same chains, the newest pools: impostor symbols, pools Chord marks suspect, LP being pulled.
// Writes state/blocklist.json, which any bot can read before it buys.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { CONFIG, ROOT } from './lib/config.js';
import { resolveChain, cap, get, findTokens, candles, mapLimit } from './lib/chord.js';
import { safe, usd, pct, short, table, writeReport, runAgent } from './lib/util.js';

const P = {
  newPools: 60,
  pullRatio: 3,            // LP removed in 24h at least 3x LP added = LP leaving
  pullMinUsd: 5_000,
  cascadeDrop1hPct: -15,
};
const SEV = { low: 1, medium: 2, high: 3, critical: 4 };

async function cycle() {
  const chain = await resolveChain(CONFIG.chain || 'base');
  const findings = new Map();
  const flag = (address, symbol, reason, severity) => {
    const k = address.toLowerCase();
    if (chain.anchorSet.has(k)) return;
    const f = findings.get(k) || { address: k, symbol, reasons: [], severity: 'low' };
    f.reasons.push(reason);
    if (SEV[severity] > SEV[f.severity]) f.severity = severity;
    findings.set(k, f);
  };

  // 1) Chord's scam screen on the 24h board.
  const all = await cap(chain, 'tokens', {}, { limit: 200, all: 1 });
  const rows = (all.tokens || []).map((t) => ({ ...t, address: t.address.toLowerCase() }));
  const level = { scam: 'critical', suspect: 'high', warn: 'medium' };
  for (const t of rows.filter((x) => x.screen)) flag(t.address, t.symbol, `Chord screen: ${(t.screen.why || t.screen.reasons || []).join('; ')}`, level[t.screen.level] || 'medium');

  // 2) Your watch list.
  const { found: watch, missing } = await findTokens(chain, (process.env.WATCH_TOKENS || '').split(',').filter(Boolean), { extraRows: rows });
  const charts = await mapLimit(watch, 3, (t) => candles(chain, t.address, { tf: '1h', limit: 3 }));
  watch.forEach((t, i) => {
    const cs = Array.isArray(charts[i]) ? charts[i] : [];
    if (cs.length >= 2) {
      const ch = (cs.at(-1).c / cs.at(-2).c - 1) * 100;
      if (ch <= P.cascadeDrop1hPct) flag(t.address, t.symbol, `price ${pct(ch)} in the last hour`, 'high');
    }
  });
  const lpChain = chain.has('lpPools') && chain.capabilities.lpPools.path === '/v1/lp/pools';
  if (lpChain && watch.length) {
    const events = await mapLimit(watch, 2, (t) => get('/lp/events', { chain: chain.id, token: t.address, limit: 100 }));
    const dayAgo = Date.now() / 1000 - 86_400;
    watch.forEach((t, i) => {
      const recent = (events[i]?.events || []).filter((e) => e.ts >= dayAgo && e.priced !== false);
      const removed = recent.filter((e) => e.kind === 'remove').reduce((a, e) => a + safe(e.usd), 0);
      const added = recent.filter((e) => e.kind === 'add').reduce((a, e) => a + safe(e.usd), 0);
      if (removed - added >= 10_000) flag(t.address, t.symbol, `net ${usd(removed - added)} of liquidity pulled in 24h`, removed >= P.pullRatio * Math.max(1, added) ? 'high' : 'medium');
    });
  }

  // 3) Newest pools (chains with Chord's LP index).
  let pools = [];
  if (lpChain) {
    pools = (await get('/lp/pools', { chain: chain.id, sort: 'first_seen', small: 1, flagged: 1, limit: P.newPools })).pools || [];
    for (const p of pools) {
      const t = p.tokenSide === 0 ? p.token0 : p.token1;
      if (!t?.address) continue;
      if (p.token0.impostor || p.token1.impostor) flag(t.address, t.symbol, `impostor symbol in pool ${p.pool.slice(0, 10)}`, 'critical');
      if (p.suspect) flag(t.address, t.symbol, `pool marked suspect by Chord (score ${p.score})`, 'high');
      if (safe(p.lpRemove24h) >= P.pullMinUsd && safe(p.lpRemove24h) >= P.pullRatio * Math.max(1, safe(p.lpAdd24h)))
        flag(t.address, t.symbol, `LP pulled ${usd(p.lpRemove24h)} vs added ${usd(p.lpAdd24h)} in 24h`, 'high');
    }
  }

  const list = [...findings.values()].map((f) => ({ ...f, reason: f.reasons.join('; ') })).sort((a, b) => SEV[b.severity] - SEV[a.severity]);
  const block = list.filter((t) => SEV[t.severity] >= SEV.high);
  mkdirSync(path.join(ROOT, 'state'), { recursive: true });
  writeFileSync(path.join(ROOT, 'state', 'blocklist.json'), JSON.stringify({ chain: chain.key, at: new Date().toISOString(), tokens: block.map(({ address, symbol, severity, reason }) => ({ address, symbol, severity, reason })) }, null, 2));

  const mine = new Set(watch.map((t) => t.address));
  const md = [
    `# Token Risk Scanner on ${chain.label}, ${new Date().toISOString()}`,
    `Board ${rows.length} tokens (${rows.filter((x) => x.screen).length} hidden by Chord's screen) · watch list ${watch.length}${missing.length ? ` (not found: ${missing.join(', ')})` : ''} · ${lpChain ? `${pools.length} newest pools checked` : 'no LP index on this chain'}.`,
    `**Block ${block.length} · watch ${list.length - block.length}** · written to state/blocklist.json`,
    '',
    watch.length ? `## Your watch list\n${table(['Token', 'Address', 'Status', 'Reason'], watch.map((t) => { const f = findings.get(t.address); return [t.symbol, short(t.address), f ? f.severity.toUpperCase() : 'clean', f ? f.reasons.join('; ') : '—']; }))}\n` : '_Set WATCH_TOKENS=SYMBOL,0xaddress,... to check your own tokens._\n',
    '## Everything flagged',
    list.length ? table(['Token', 'Address', 'Severity', 'Reason'], list.filter((t) => !mine.has(t.address)).slice(0, 30).map((t) => [t.symbol, short(t.address), t.severity.toUpperCase(), t.reason])) : 'No danger signals.',
  ].join('\n');
  writeReport('report.md', md);
  console.log(md);
  return { report: md, rows: list.map(({ address, symbol, severity, reason }) => ({ chain: chain.key, address, symbol, severity, reason, watched: mine.has(address) })) };
}

export { cycle };

if (import.meta.url === `file://${process.argv[1]}`) runAgent('token-risk-scanner', cycle, 600, { readOnly: true });
