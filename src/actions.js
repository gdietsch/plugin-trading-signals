import { callRoute, resolveConfig } from "./client.js";
import { readParams, detectChain, findHours, findAmount } from "./parse.js";

export const ROUTES = Object.freeze({
  baseVerdict: { path: "/base/token-verdict", price: 0.01 },
  solanaVerdict: { path: "/solana/token-verdict", price: 0.01 },
  tokenPack: { path: "/bundle/token-pre-trade", price: 0.015 },
  whaleFlow: { path: "/crypto/whale-flow", price: 0.02 },
});

const NFA = "Heuristic data, not financial advice.";
const KEYWORDS = /\b(token|coin|mint|contract|rug|honeypot|scam|safe|risk|verdict|sniper|bundle|holder|whale|flow|accumulat|distribut|dump|pre-?trade|ape|buy|swap)\w*/i;

const fmtUsd = (n) => (n == null || !Number.isFinite(Number(n)) ? "n/a" : `$${Math.round(Number(n)).toLocaleString("en-US")}`);
const reasonText = (r) => (typeof r === "string" ? r.replace(/^[-+]?\d+(?:\.\d+)?:\s*/, "") : r?.text || r?.reason || r?.message || r?.label || JSON.stringify(r));
const tokenLabel = (d, addr) => {
  const t = d?.token || {};
  const sym = t.symbol || d?.symbol;
  return sym ? `${sym} (${addr})` : addr;
};

export function formatVerdict(d, addr, chain) {
  const v = d?.verdict || {};
  const reasons = Array.isArray(v.reasons) ? v.reasons.slice(0, 6).map((r) => `- ${reasonText(r)}`).join("\n") : "";
  return `Token risk verdict for ${tokenLabel(d, addr)} on ${chain}: ${String(v.rating || "unknown").toUpperCase()}${v.grade ? ` (grade ${v.grade})` : ""}.${reasons ? `\n${reasons}` : ""}\n${NFA}`;
}

export function formatPack(d, addr) {
  const reasons = Array.isArray(d?.reasons) ? d.reasons.slice(0, 6).map((r) => `- ${reasonText(r)}`).join("\n") : "";
  const tv = d?.token?.verdict?.rating ? ` Token verdict: ${d.token.verdict.rating}.` : "";
  const sanc = d?.sanctions?.available ? ` OFAC matches: ${d.sanctions.matches ?? 0}.` : "";
  const w = d?.wallet?.available ? ` Wallet: ${d.wallet.status}${d.wallet.canPay != null ? `, canPay=${d.wallet.canPay}` : ""}.` : "";
  return `Pre-trade decision for ${tokenLabel(d, addr)}: ${d?.decision || "unknown"}.${tv}${sanc}${w}${reasons ? `\n${reasons}` : ""}\n${NFA}`;
}

export function formatWhale(d, addr, hours) {
  const s = d?.summary || {};
  const pct = s.netFlowPctOfLiquidity != null ? ` (${s.netFlowPctOfLiquidity}% of liquidity)` : "";
  return `Whale flow for ${tokenLabel(d, addr)}, last ${hours ?? 24}h: ${String(s.signal || "unknown").replace(/_/g, " ")}. ` +
    `${s.whaleBuys ?? 0} whale buys ${fmtUsd(s.whaleBuyUsd)} vs ${s.whaleSells ?? 0} sells ${fmtUsd(s.whaleSellUsd)}, net ${fmtUsd(s.netFlowUsd)}${pct}, ${s.uniqueWhaleWallets ?? 0} wallets.\n${NFA}`;
}

function paidNote(r) {
  if (r.via === "x402" && r.payment?.transaction) return ` Paid $${r.payment.priceUsd} USDC (${r.payment.explorer}).`;
  if (r.via === "api_key" && r.quotaRemaining != null) return ` Free key: ${r.quotaRemaining} calls left this month.`;
  return "";
}

async function finish(name, r, text, callback) {
  const result = r.ok
    ? { success: true, text: text + paidNote(r), data: { actionName: name, response: r.data, payment: r.payment ?? null, via: r.via }, values: { tradingSignalsLastAction: name } }
    : { success: false, text: `Trading Signals ${name} failed: ${r.message || r.error}`, error: r.error, data: { actionName: name, status: r.status ?? null } };
  if (callback) await callback({ text: result.text, actions: [name], source: "trading-signals" });
  return result;
}

const fail = async (name, message, callback) => finish(name, { ok: false, error: "missing_input", message }, "", callback);

async function validateMsg(_runtime, message, _state, options) {
  const { p, text, addrs } = readParams(message, options);
  return Boolean(p.token || p.address || p.mint || addrs.length || KEYWORDS.test(text));
}

export const tokenRiskVerdictAction = {
  name: "TOKEN_RISK_VERDICT",
  similes: ["CHECK_TOKEN_SAFETY", "RUG_CHECK", "HONEYPOT_CHECK", "TOKEN_SAFETY_CHECK", "SOLANA_TOKEN_VERDICT", "BASE_TOKEN_VERDICT"],
  description: "Check whether a Base ERC-20 or Solana SPL/Token-2022 token is safe before buying or accepting it. Returns safe / caution / avoid with an A-F grade and reasons (mint/freeze authority, honeypot or sell test, LP lock, top-holder concentration, sniper/bundle wallets, contract flags). Costs $0.01 per call (free key or x402 USDC).",
  tags: ["crypto", "token", "risk", "rug-check", "solana", "base"],
  parameters: [
    { name: "token", description: "Token address: Base ERC-20 (0x...) or Solana mint (base58)", required: true, schema: { type: "string" } },
    { name: "chain", description: "base or solana (default: detected from the address format)", required: false, schema: { type: "string", enum: ["base", "solana"] } },
  ],
  validate: validateMsg,
  handler: async (runtime, message, _state, options, callback) => {
    const name = "TOKEN_RISK_VERDICT";
    const { p, addrs } = readParams(message, options);
    const token = p.token || p.address || p.mint || addrs[0]?.address;
    if (!token) return fail(name, "No token address found. Send a Base 0x... address or a Solana mint.", callback);
    const chain = (p.chain === "base" || p.chain === "solana") ? p.chain : detectChain(token);
    if (!chain) return fail(name, `"${token}" is not a Base 0x address or a Solana mint.`, callback);
    let cfg;
    try { cfg = resolveConfig(runtime); } catch (e) { return fail(name, e.message, callback); }
    const r = chain === "base"
      ? await callRoute(ROUTES.baseVerdict, { address: token }, cfg)
      : await callRoute(ROUTES.solanaVerdict, { mint: token }, cfg);
    return finish(name, r, r.ok ? formatVerdict(r.data, token, chain) : "", callback);
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "Is this token safe to ape? DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" } },
      { name: "{{agent}}", content: { text: "Running a token risk verdict on that Solana mint.", actions: ["TOKEN_RISK_VERDICT"] } },
    ],
    [
      { name: "{{user}}", content: { text: "rug check 0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed on base" } },
      { name: "{{agent}}", content: { text: "Checking that Base token for honeypot, LP lock and holder risk.", actions: ["TOKEN_RISK_VERDICT"] } },
    ],
  ],
};

export const tokenPreTradePackAction = {
  name: "TOKEN_PRE_TRADE_PACK",
  similes: ["PRE_TRADE_CHECK", "TOKEN_PRE_TRADE", "GO_NO_GO_TOKEN", "CHECK_BEFORE_SWAP"],
  description: "One GO / CAUTION / STOP decision before buying or paying with a Base or Solana token: token risk verdict, OFAC sanctions screen of the token's authorities/owner and an optional counterparty wallet, and that wallet's USDC pay-readiness. Costs $0.015 per call (free key or x402 USDC).",
  tags: ["crypto", "token", "pre-trade", "sanctions", "solana", "base"],
  parameters: [
    { name: "token", description: "Token address: Base ERC-20 (0x...) or Solana mint (base58)", required: true, schema: { type: "string" } },
    { name: "chain", description: "Token chain: base or solana (default: detected)", required: false, schema: { type: "string", enum: ["base", "solana"] } },
    { name: "wallet", description: "Optional counterparty or paying wallet to screen (Base 0x... or Solana base58)", required: false, schema: { type: "string" } },
    { name: "amount", description: "Optional USDC amount the wallet wants to pay (default 1; needs wallet)", required: false, schema: { type: "number" } },
  ],
  validate: validateMsg,
  handler: async (runtime, message, _state, options, callback) => {
    const name = "TOKEN_PRE_TRADE_PACK";
    const { p, text, addrs } = readParams(message, options);
    const token = p.token || p.address || addrs[0]?.address;
    if (!token) return fail(name, "No token address found. Send a Base 0x... address or a Solana mint.", callback);
    const wallet = p.wallet || addrs.find((a) => a.address !== token)?.address;
    const amount = p.amount != null && p.amount !== "" ? Number(p.amount) : (wallet ? findAmount(text) : undefined);
    const chain = (p.chain === "base" || p.chain === "solana") ? p.chain : undefined;
    let cfg;
    try { cfg = resolveConfig(runtime); } catch (e) { return fail(name, e.message, callback); }
    const r = await callRoute(ROUTES.tokenPack, { token, chain, wallet, amount: wallet ? amount : undefined }, cfg);
    return finish(name, r, r.ok ? formatPack(r.data, token) : "", callback);
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "Pre-trade check DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263, paying from 0x6d7be981c103eD360874a7703ad3CD6a98929aFB, $5" } },
      { name: "{{agent}}", content: { text: "Running the token pre-trade pack (verdict, sanctions, wallet readiness).", actions: ["TOKEN_PRE_TRADE_PACK"] } },
    ],
  ],
};

export const whaleFlowAction = {
  name: "WHALE_FLOW",
  similes: ["WHALE_TRACKER", "SMART_MONEY_FLOW", "WHALE_BUYS", "TOKEN_WHALE_ACTIVITY", "ACCUMULATION_CHECK"],
  description: "See whether big wallets are accumulating or dumping a Base or Solana token: large DEX trades in the last 1-24h, whale buy vs sell USD, net flow and % of liquidity, accumulation/distribution signal, top wallets. Costs $0.02 per call (free key or x402 USDC).",
  tags: ["crypto", "whales", "smart-money", "on-chain", "solana", "base"],
  parameters: [
    { name: "token", description: "Token address: Base ERC-20 (0x...) or Solana mint (base58)", required: true, schema: { type: "string" } },
    { name: "chain", description: "base or solana (default: detected)", required: false, schema: { type: "string", enum: ["base", "solana"] } },
    { name: "hours", description: "Look-back window in hours, 1-24 (default 24)", required: false, schema: { type: "integer", minimum: 1, maximum: 24 } },
    { name: "minUsd", description: "Minimum trade size in USD, 50-1000000 (default: auto from liquidity)", required: false, schema: { type: "number" } },
  ],
  validate: validateMsg,
  handler: async (runtime, message, _state, options, callback) => {
    const name = "WHALE_FLOW";
    const { p, text, addrs } = readParams(message, options);
    const token = p.token || p.address || addrs[0]?.address;
    if (!token) return fail(name, "No token address found. Send a Base 0x... address or a Solana mint.", callback);
    const hours = p.hours != null && p.hours !== "" ? Number(p.hours) : findHours(text);
    const chain = (p.chain === "base" || p.chain === "solana") ? p.chain : undefined;
    let cfg;
    try { cfg = resolveConfig(runtime); } catch (e) { return fail(name, e.message, callback); }
    const r = await callRoute(ROUTES.whaleFlow, { token, chain, hours, minUsd: p.minUsd }, cfg);
    return finish(name, r, r.ok ? formatWhale(r.data, token, hours) : "", callback);
  },
  examples: [
    [
      { name: "{{user}}", content: { text: "are whales buying or dumping DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 in the last 6 hours?" } },
      { name: "{{agent}}", content: { text: "Pulling whale flow for that token over the last 6h.", actions: ["WHALE_FLOW"] } },
    ],
  ],
};

export const actions = [tokenRiskVerdictAction, tokenPreTradePackAction, whaleFlowAction];
