// Call the plugin's client directly, outside an agent: node examples/direct-call.mjs <token>
// Needs TRADING_SIGNALS_API_KEY or a wallet key in the environment (see .env.example).
import { callRoute, resolveConfig, ROUTES } from "@gdietsch/plugin-trading-signals";

const token = process.argv[2] || "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const cfg = resolveConfig();
const route = token.startsWith("0x") ? ROUTES.baseVerdict : ROUTES.solanaVerdict;
const r = await callRoute(route, token.startsWith("0x") ? { address: token } : { mint: token }, cfg);
console.log(JSON.stringify(r.ok ? { verdict: r.data.verdict, via: r.via, payment: r.payment } : r, null, 2));
