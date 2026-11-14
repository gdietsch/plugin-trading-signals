/**
 * HTTP client for the Trading Signals Toolkit (https://signals.incomefather.com).
 *
 * Auth order for every call:
 *   1. TRADING_SIGNALS_API_KEY (free key, 100 calls/month) -> sent as x-api-key, no wallet payment.
 *      If its monthly quota is used up (HTTP 429) and a wallet is configured, the call falls back to x402.
 *   2. x402 pay-per-call in USDC from the agent's own wallet:
 *      Base   - TRADING_SIGNALS_EVM_PRIVATE_KEY, else EVM_PRIVATE_KEY (0x + 64 hex)
 *      Solana - TRADING_SIGNALS_SOLANA_PRIVATE_KEY, else SOLANA_PRIVATE_KEY (base58 or JSON byte array)
 *   Payments are capped per call (TRADING_SIGNALS_MAX_USD_PER_CALL, default 0.05) and per
 *   process per UTC day (TRADING_SIGNALS_MAX_USD_PER_DAY, default 1.00).
 *
 * Private keys are only used to sign x402 payment authorizations locally. They are never
 * logged, returned or sent anywhere.
 */
export const DEFAULT_BASE_URL = "https://signals.incomefather.com";
export const BASE_MAINNET = "eip155:8453";
export const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const USDC_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const FREE_KEY_URL = "https://signals.incomefather.com/pricing";
const VERSION = "0.1.0";

/** Read a setting from the ElizaOS runtime first, then process.env. */
export function getSetting(runtime, key, env = process.env) {
  let v;
  try { v = runtime?.getSetting?.(key); } catch { v = undefined; }
  if (v === undefined || v === null || v === "") v = env[key];
  return v === undefined || v === null ? "" : String(v).trim();
}

export function resolveConfig(runtime, env = process.env) {
  const s = (k) => getSetting(runtime, k, env);
  const num = (k, d) => {
    const raw = s(k);
    if (raw === "") return d;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${k} must be a positive number of USD`);
    return n;
  };
  const preferred = (s("TRADING_SIGNALS_PREFERRED_NETWORK") || "").toLowerCase();
  return {
    baseUrl: (s("TRADING_SIGNALS_BASE_URL") || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    apiKey: s("TRADING_SIGNALS_API_KEY"),
    evmKey: s("TRADING_SIGNALS_EVM_PRIVATE_KEY") || s("EVM_PRIVATE_KEY"),
    solanaKey: s("TRADING_SIGNALS_SOLANA_PRIVATE_KEY") || s("SOLANA_PRIVATE_KEY"),
    solanaRpcUrl: s("TRADING_SIGNALS_SOLANA_RPC_URL") || s("SOLANA_RPC_URL"),
    preferred: preferred === "solana" ? "solana" : preferred === "base" ? "base" : "",
    maxUsdPerCall: num("TRADING_SIGNALS_MAX_USD_PER_CALL", 0.05),
    maxUsdPerDay: num("TRADING_SIGNALS_MAX_USD_PER_DAY", 1),
    timeoutMs: Number(s("TRADING_SIGNALS_TIMEOUT_MS")) || 90_000,
  };
}

// ---- daily spend guard (in-memory, per process, resets each UTC day) ----
const spend = { day: "", usd: 0 };
function today() { return new Date().toISOString().slice(0, 10); }
export function spentToday() { if (spend.day !== today()) { spend.day = today(); spend.usd = 0; } return spend.usd; }
function addSpend(usd) { spentToday(); spend.usd += usd; }
export function _resetSpend() { spend.day = ""; spend.usd = 0; }

async function solanaSigner(secret) {
  const kit = await import("@solana/kit");
  let bytes;
  const t = secret.trim();
  if (t.startsWith("[")) bytes = Uint8Array.from(JSON.parse(t));
  else bytes = kit.getBase58Encoder().encode(t);
  if (bytes.length !== 64) throw new Error("Solana private key must be a 64-byte secret key (base58 or JSON byte array)");
  return kit.createKeyPairSignerFromBytes(bytes);
}

function normalizeEvmKey(k) {
  const key = k.startsWith("0x") ? k : `0x${k}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("EVM private key must be 32-byte hex (0x + 64 hex chars)");
  return key;
}

/** Build an x402 paying fetch for the configured wallet(s). Returns null when no wallet is set. */
export async function createPayingFetch(cfg, baseFetch = globalThis.fetch) {
  if (!cfg.evmKey && !cfg.solanaKey) return null;
  const [{ wrapFetchWithPaymentFromConfig }] = await Promise.all([import("@x402/fetch")]);
  const schemes = [];
  const payers = {};
  if (cfg.evmKey) {
    const [{ ExactEvmScheme }, { privateKeyToAccount }] = await Promise.all([import("@x402/evm/exact/client"), import("viem/accounts")]);
    const account = privateKeyToAccount(normalizeEvmKey(cfg.evmKey));
    payers.base = account.address;
    schemes.push({ network: BASE_MAINNET, client: new ExactEvmScheme(account) });
  }
  if (cfg.solanaKey) {
    const { ExactSvmScheme } = await import("@x402/svm/exact/client");
    const signer = await solanaSigner(cfg.solanaKey);
    payers.solana = signer.address;
    schemes.push({ network: SOLANA_MAINNET, client: new ExactSvmScheme(signer, cfg.solanaRpcUrl ? { rpcUrl: cfg.solanaRpcUrl } : undefined) });
  }
  const capAtomic = BigInt(Math.round(cfg.maxUsdPerCall * 1e6));
  const allowed = (r) => (r.network === BASE_MAINNET && String(r.asset || "").toLowerCase() === USDC_BASE && payers.base)
    || (r.network === SOLANA_MAINNET && r.asset === USDC_SOLANA && payers.solana);
  const order = cfg.preferred === "solana" ? [SOLANA_MAINNET, BASE_MAINNET] : [BASE_MAINNET, SOLANA_MAINNET];
  const f = wrapFetchWithPaymentFromConfig(baseFetch, {
    schemes,
    spendControls: { maxAmountPerPayment: `$${cfg.maxUsdPerCall}` },
    // Only ever pay USDC on Base or Solana mainnet, at or below the per-call cap, preferred network first.
    policies: [
      (_v, reqs) => reqs
        .filter((r) => allowed(r) && BigInt(r.amount ?? r.maxAmountRequired ?? "0") <= capAtomic)
        .sort((a, b) => order.indexOf(a.network) - order.indexOf(b.network)),
    ],
  });
  return { fetch: f, payers };
}

const payingCache = new Map();

function explorer(network, tx) {
  if (!tx) return undefined;
  return String(network || "").startsWith("solana") ? `https://solscan.io/tx/${tx}` : `https://basescan.org/tx/${tx}`;
}

/**
 * Call one paid route. Never throws; returns { ok, status, data, payment?, error?, message? }.
 * deps: { fetch, payingFetch } for tests.
 */
export async function callRoute(route, params, cfg, deps = {}) {
  const baseFetch = deps.fetch || globalThis.fetch;
  const clean = Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  const qs = new URLSearchParams(Object.entries(clean).map(([k, v]) => [k, String(v)])).toString();
  const url = `${cfg.baseUrl}${route.path}${qs ? `?${qs}` : ""}`;
  const headers = { Accept: "application/json", "User-Agent": `plugin-trading-signals/${VERSION} (elizaos)` };

  const run = async (f, extraHeaders = {}) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
    try {
      const res = await f(url, { method: "GET", headers: { ...headers, ...extraHeaders }, signal: ctrl.signal });
      const raw = await res.text();
      let body;
      try { body = JSON.parse(raw); } catch { body = raw.slice(0, 2000); }
      return { res, body };
    } catch (e) {
      return { err: e?.name === "AbortError" ? `timed out after ${cfg.timeoutMs} ms; retry shortly` : String(e?.message || e) };
    } finally { clearTimeout(timer); }
  };

  // 1) Free / plan API key.
  if (cfg.apiKey) {
    const r = await run(baseFetch, { "x-api-key": cfg.apiKey });
    if (r.err) return { ok: false, error: "request_failed", message: r.err };
    if (r.res.ok) return { ok: true, status: r.res.status, data: r.body, via: "api_key", quotaRemaining: r.res.headers.get("x-quota-remaining") };
    const walletSet = Boolean(cfg.evmKey || cfg.solanaKey);
    if (!(r.res.status === 429 && walletSet)) {
      return { ok: false, status: r.res.status, error: r.res.status === 429 ? "quota_exceeded" : "api_error", message: typeof r.body === "object" ? r.body?.message || r.body?.error : String(r.body), data: r.body };
    }
    // quota used up -> fall through to wallet payment
  }

  // 2) x402 wallet payment.
  if (!cfg.evmKey && !cfg.solanaKey) {
    return {
      ok: false, error: "not_configured",
      message: `This check costs $${route.price} per call. Set TRADING_SIGNALS_API_KEY to a free key (100 calls/month, ${FREE_KEY_URL}) or a dedicated low-balance wallet key (TRADING_SIGNALS_EVM_PRIVATE_KEY for USDC on Base, or TRADING_SIGNALS_SOLANA_PRIVATE_KEY for USDC on Solana). Nothing was charged.`,
    };
  }
  if (route.price > cfg.maxUsdPerCall) {
    return { ok: false, error: "over_cap", message: `Refused: costs $${route.price}, above TRADING_SIGNALS_MAX_USD_PER_CALL=${cfg.maxUsdPerCall}. Nothing was charged.` };
  }
  if (spentToday() + route.price > cfg.maxUsdPerDay + 1e-9) {
    return { ok: false, error: "daily_budget", message: `Refused: daily budget TRADING_SIGNALS_MAX_USD_PER_DAY=${cfg.maxUsdPerDay} reached ($${spentToday().toFixed(3)} spent today). Nothing was charged.` };
  }
  let pf = deps.payingFetch;
  if (!pf) {
    const cacheKey = [cfg.evmKey, cfg.solanaKey, cfg.solanaRpcUrl, cfg.preferred, cfg.maxUsdPerCall].join("|");
    pf = payingCache.get(cacheKey);
    if (!pf) {
      try { pf = await createPayingFetch(cfg, baseFetch); } catch (e) { return { ok: false, error: "config_error", message: `Wallet configuration error: ${e.message}` }; }
      payingCache.clear();
      payingCache.set(cacheKey, pf);
    }
  }
  const r = await run(pf.fetch);
  if (r.err) return { ok: false, error: "request_failed", message: r.err };
  let payment = null;
  const pr = r.res.headers.get("payment-response") || r.res.headers.get("x-payment-response");
  if (pr) {
    try {
      const { decodePaymentResponseHeader } = await import("@x402/fetch");
      const d = decodePaymentResponseHeader(pr);
      payment = { priceUsd: route.price, success: d.success, network: d.network, transaction: d.transaction, explorer: explorer(d.network, d.transaction) };
    } catch { /* ignore malformed header */ }
  }
  if (!r.res.ok) {
    if (r.res.status === 402) {
      const who = Object.entries(pf.payers || {}).map(([n, a]) => `${n} ${a}`).join(", ");
      return { ok: false, status: 402, error: "payment_not_completed", message: `Payment was not accepted. Check that the wallet (${who}) holds a little USDC and the price ($${route.price}) is within the per-call cap.` };
    }
    return { ok: false, status: r.res.status, error: "api_error", message: typeof r.body === "object" ? r.body?.message || r.body?.error : String(r.body), data: r.body, charged: false };
  }
  if (payment?.success !== false) addSpend(route.price);
  return { ok: true, status: r.res.status, data: r.body, via: "x402", payment };
}
