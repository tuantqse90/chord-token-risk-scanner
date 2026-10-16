# Chord Token Risk Scanner

Never trades: lists tokens Chord's scam screen hides, checks your watch list for dumps and pulled liquidity, writes a blocklist any bot can read.

An example agent built on [Chord](https://getchord.xyz), the trading API and on-chain data index for agents. Read-only: it never trades. Not financial advice.

## Run it

Node 20.12 or newer. Nothing to install and no key for this agent.

```bash
git clone https://github.com/tuantqse90/chord-token-risk-scanner
cd chord-token-risk-scanner
node index.js                    # one cycle on base
node index.js --chain arbitrum   # another chain
node index.js --loop             # every 10 min (--interval <seconds> to change)
```

The report prints to the terminal and is saved to `state/report.md`.

## What it does each cycle

1. Reads the chain's 24h board including the tokens Chord's scam screen hides, with the reason in words: a few wallets making the volume, wash trading, buyer clusters, a price collapsed from its 24h high, a major's ticker on another address.
2. Checks your `WATCH_TOKENS`: screen status, a 15% drop in the last hour, and (on Monad, Robinhood and Arc) liquidity pulled in the last 24 hours.
3. On Monad, Robinhood and Arc, checks the 60 newest pools for impostor symbols, pools Chord marks suspect and LP being pulled.
4. Writes `state/blocklist.json` (high and critical findings) for any bot to read before it buys.

## Output

`state/blocklist.json`, rewritten every cycle with the high and critical findings:

```json
{
  "chain": "base",
  "at": "2026-10-16T14:30:47.560Z",
  "tokens": [
    { "address": "0x…", "symbol": "…", "severity": "critical", "reason": "Chord screen: one wallet made 97% of the 24 h volume" }
  ]
}
```

A trading bot reads it before every buy and skips those addresses. The report in `state/report.md` also lists the medium findings with their reasons.

## Chains

Ethereum, Base, Arbitrum, BNB Chain, Avalanche, Monad, Robinhood and Arc (keys `ethereum`, `base`, `arbitrum`, `bnb`, `avalanche`, `monad`, `robinhood`, `arc`). The liquidity checks run on Monad, Robinhood and Arc. Pick one with `CHAIN=` in `.env` or `--chain`.

## Settings

Copy `.env.example` to `.env`. Every setting is optional.

| Variable | Default | What it does |
| --- | --- | --- |
| `CHAIN` | `base` | Chain key or id. |
| `WATCH_TOKENS` | — | Comma list of symbols or 0x addresses to check. |
| `CHORD_API` | `https://api.getchord.xyz/v1` | Chord API base URL. |
| `CHORD_API_KEY` | — | Optional. Not needed for anything this agent calls. |
| `CHORD_RPM` | `50` | Client-side request cap per minute (anonymous callers get 60 per IP). |

## Built on Chord

Chord calls this agent makes:

- the token board with `all=1` (the scam screen)
- `GET /v1/candles`
- `GET /v1/lp/events` and `GET /v1/lp/pools`

No key is needed: anonymous callers get 60 requests a minute per IP, and the client in `lib/chord.js` stays under that, caches reads briefly and backs off on 429.

- Docs and OpenAPI: https://getchord.xyz/docs
- Hosted MCP server for LLM agents (quotes, unsigned swaps, token boards, trades, wallet PnL; no key): `https://api.getchord.xyz/v1/mcp`. In Claude Code: `claude mcp add --transport http chord https://api.getchord.xyz/v1/mcp`
- More templates: https://github.com/tuantqse90/chord-agent-templates

## Files

```text
index.js          the agent
lib/chord.js      Chord client: rate limit, cache, chain paths from GET /v1/chains
lib/config.js     settings from .env
lib/util.js       formatting, --loop runner
.actor/, actor.js the same agent packaged as an Apify Actor
```

## Disclaimer

Example code, not financial advice. Backtests and paper results do not predict real results.

## License

MIT
