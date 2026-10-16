// Apify Actor entry: maps the Actor input to the agent's settings, runs one cycle and stores the rows.
// Not needed to run the agent locally (use `node index.js`).
import { Actor } from 'apify';

await Actor.init();
const input = (await Actor.getInput()) || {};
const ENV = {"chain": "CHAIN", "watchTokens": "WATCH_TOKENS"};
for (const [k, v] of Object.entries(ENV)) if (input[k] !== undefined && input[k] !== null && input[k] !== '') process.env[v] = String(input[k]);

const { cycle } = await import('./index.js');
const out = await cycle({});
await Actor.pushData(out.rows);
await Actor.setValue('REPORT', out.report, { contentType: 'text/markdown' });
await Actor.exit();
