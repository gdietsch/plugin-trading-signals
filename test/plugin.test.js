import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import plugin, { tokenRiskVerdictAction, tokenPreTradePackAction, whaleFlowAction, ROUTES, callRoute, resolveConfig } from "../src/index.js";
import { findAddresses, detectChain, findHours, findAmount } from "../src/parse.js";
import { _resetSpend } from "../src/client.js";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const DEGEN = "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed";
const WALLET = "0x6d7be981c103eD360874a7703ad3CD6a98929aFB";

const rt = (settings = {}) => ({ getSetting: (k) => settings[k] });
const msg = (text) => ({ content: { text } });
const jsonRes = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

beforeEach(() => _resetSpend());

test("plugin shape follows ElizaOS conventions", () => {
  assert.equal(plugin.name, "trading-signals");
  assert.ok(plugin.description.length > 20);
  assert.deepEqual(plugin.actions.map((a) => a.name), ["TOKEN_RISK_VERDICT", "TOKEN_PRE_TRADE_PACK", "WHALE_FLOW"]);
  for (const a of plugin.actions) {
    assert.equal(typeof a.handler, "function");
    assert.equal(typeof a.validate, "function");
    assert.ok(Array.isArray(a.similes) && a.similes.length);
    assert.ok(Array.isArray(a.examples) && a.examples.length);
    assert.ok(a.parameters.find((p) => p.name === "token" && p.required));
  }
  assert.equal(ROUTES.baseVerdict.price, 0.01);
  assert.equal(ROUTES.solanaVerdict.price, 0.01);
  assert.equal(ROUTES.tokenPack.price, 0.015);
  assert.equal(ROUTES.whaleFlow.price, 0.02);
});

test("address and option parsing", () => {
  assert.deepEqual(findAddresses(`check ${BONK} and ${DEGEN}`), [{ address: BONK, chain: "solana" }, { address: DEGEN, chain: "base" }]);
  assert.deepEqual(findAddresses("is this token safe to buy right now please"), []);
  assert.equal(detectChain(DEGEN), "base");
  assert.equal(detectChain(BONK), "solana");
  assert.equal(detectChain("hello"), null);
  assert.equal(findHours("last 6 hours"), 6);
  assert.equal(findHours("last 48h"), undefined);
  assert.equal(findAmount("pay $5 now"), 5);
  assert.equal(findAmount("2.5 USDC"), 2.5);
});

test("validate fires on addresses or token keywords only", async () => {
  assert.equal(await tokenRiskVerdictAction.validate(rt(), msg(`what about ${BONK}`)), true);
  assert.equal(await whaleFlowAction.validate(rt(), msg("are whales dumping this?")), true);
  assert.equal(await tokenRiskVerdictAction.validate(rt(), msg("good morning")), false);
  assert.equal(await tokenRiskVerdictAction.validate(rt(), msg("hi"), undefined, { parameters: { token: BONK } }), true);
});

test("no API key and no wallet: refuses without any network call", async () => {
  let calls = 0;
  const r = await callRoute(ROUTES.solanaVerdict, { mint: BONK }, resolveConfig(rt(), {}), { fetch: async () => { calls++; } });
  assert.equal(r.ok, false);
  assert.equal(r.error, "not_configured");
  assert.match(r.message, /free key/);
  assert.equal(calls, 0);
});

test("free API key is sent as x-api-key with the right route and params", async () => {
  let seen;
  const fetch = async (url, init) => { seen = { url, init }; return jsonRes(200, { verdict: { rating: "safe", grade: "A", score: 92, reasons: ["Mint authority revoked"] }, token: { symbol: "BONK" } }, { "x-quota-remaining": "99" }); };
  const cfg = resolveConfig(rt({ TRADING_SIGNALS_API_KEY: "tsk_test" }), {});
  const r = await callRoute(ROUTES.solanaVerdict, { mint: BONK }, cfg, { fetch });
  assert.equal(r.ok, true);
  assert.equal(r.via, "api_key");
  assert.equal(seen.url, `https://signals.incomefather.com/solana/token-verdict?mint=${BONK}`);
  assert.equal(seen.init.headers["x-api-key"], "tsk_test");
  assert.equal(r.quotaRemaining, "99");
});

test("API key quota used up falls back to the x402 wallet", async () => {
  const fetch = async () => jsonRes(429, { error: "quota_exceeded" });
  let paid = 0;
  const payingFetch = { payers: { base: "0xabc" }, fetch: async (url) => { paid++; assert.match(url, /\/crypto\/whale-flow\?token=/); return jsonRes(200, { summary: { signal: "accumulation" } }); } };
  const cfg = resolveConfig(rt({ TRADING_SIGNALS_API_KEY: "tsk_test", TRADING_SIGNALS_EVM_PRIVATE_KEY: "0x" + "11".repeat(32) }), {});
  const r = await callRoute(ROUTES.whaleFlow, { token: BONK }, cfg, { fetch, payingFetch });
  assert.equal(r.ok, true);
  assert.equal(r.via, "x402");
  assert.equal(paid, 1);
});

test("API key quota used up without a wallet reports quota_exceeded", async () => {
  const cfg = resolveConfig(rt({ TRADING_SIGNALS_API_KEY: "tsk_test" }), {});
  const r = await callRoute(ROUTES.whaleFlow, { token: BONK }, cfg, { fetch: async () => jsonRes(429, { error: "quota_exceeded", message: "Free plan monthly quota of 100 calls has been reached." }) });
  assert.equal(r.ok, false);
  assert.equal(r.error, "quota_exceeded");
});

test("per-call cap and daily budget are enforced before paying", async () => {
  const payingFetch = { payers: {}, fetch: async () => jsonRes(200, {}) };
  const key = "0x" + "22".repeat(32);
  const lowCap = resolveConfig(rt({ EVM_PRIVATE_KEY: key, TRADING_SIGNALS_MAX_USD_PER_CALL: "0.01" }), {});
  const over = await callRoute(ROUTES.whaleFlow, { token: BONK }, lowCap, { payingFetch });
  assert.equal(over.error, "over_cap");
  const tinyDay = resolveConfig(rt({ EVM_PRIVATE_KEY: key, TRADING_SIGNALS_MAX_USD_PER_DAY: "0.03" }), {});
  assert.equal((await callRoute(ROUTES.whaleFlow, { token: BONK }, tinyDay, { payingFetch })).ok, true);
  assert.equal((await callRoute(ROUTES.baseVerdict, { address: DEGEN }, tinyDay, { payingFetch })).ok, true);
  const third = await callRoute(ROUTES.baseVerdict, { address: DEGEN }, tinyDay, { payingFetch });
  assert.equal(third.error, "daily_budget");
});

test("bad settings fail cleanly", () => {
  assert.throws(() => resolveConfig(rt({ TRADING_SIGNALS_MAX_USD_PER_CALL: "-1" }), {}), /positive/);
});

test("TOKEN_RISK_VERDICT routes Base addresses to /base/token-verdict and replies via callback", async (t) => {
  const orig = globalThis.fetch;
  let url;
  globalThis.fetch = async (u) => { url = u; return jsonRes(200, { token: { symbol: "DEGEN" }, verdict: { rating: "caution", grade: "C", reasons: ["Top 10 holders own 45%"] } }); };
  t.after(() => { globalThis.fetch = orig; });
  const replies = [];
  const r = await tokenRiskVerdictAction.handler(rt({ TRADING_SIGNALS_API_KEY: "tsk_x" }), msg(`rug check ${DEGEN}`), undefined, {}, async (c) => { replies.push(c); return []; });
  assert.match(url, /\/base\/token-verdict\?address=0x4ed4/);
  assert.equal(r.success, true);
  assert.match(r.text, /CAUTION \(grade C\)/);
  assert.match(r.text, /not financial advice/);
  assert.equal(replies[0].actions[0], "TOKEN_RISK_VERDICT");
});

test("TOKEN_PRE_TRADE_PACK passes token, wallet and amount", async (t) => {
  const orig = globalThis.fetch;
  let url;
  globalThis.fetch = async (u) => { url = new URL(u); return jsonRes(200, { decision: "GO", reasons: ["clear"], token: { symbol: "BONK", verdict: { rating: "safe" } }, sanctions: { available: true, matches: 0 }, wallet: { available: true, status: "ok", canPay: true } }); };
  t.after(() => { globalThis.fetch = orig; });
  const r = await tokenPreTradePackAction.handler(rt({ TRADING_SIGNALS_API_KEY: "tsk_x" }), msg(`pre-trade ${BONK} from ${WALLET} for $5`), undefined, {});
  assert.equal(url.pathname, "/bundle/token-pre-trade");
  assert.equal(url.searchParams.get("token"), BONK);
  assert.equal(url.searchParams.get("wallet"), WALLET);
  assert.equal(url.searchParams.get("amount"), "5");
  assert.match(r.text, /decision for BONK .*: GO/);
});

test("WHALE_FLOW uses v2 action parameters over message text", async (t) => {
  const orig = globalThis.fetch;
  let url;
  globalThis.fetch = async (u) => { url = new URL(u); return jsonRes(200, { summary: { signal: "distribution", whaleBuys: 2, whaleSells: 9, whaleBuyUsd: 12000, whaleSellUsd: 88000, netFlowUsd: -76000, netFlowPctOfLiquidity: -3.1, uniqueWhaleWallets: 7 } }); };
  t.after(() => { globalThis.fetch = orig; });
  const r = await whaleFlowAction.handler(rt({ TRADING_SIGNALS_API_KEY: "tsk_x" }), msg("whales?"), undefined, { parameters: { token: BONK, hours: 6 } });
  assert.equal(url.pathname, "/crypto/whale-flow");
  assert.equal(url.searchParams.get("hours"), "6");
  assert.match(r.text, /last 6h: distribution\. 2 whale buys \$12,000 vs 9 sells \$88,000, net \$-76,000 \(-3\.1% of liquidity\)/);
});

test("handlers report a missing address without calling the API", async () => {
  const r = await whaleFlowAction.handler(rt({ TRADING_SIGNALS_API_KEY: "tsk_x" }), msg("are whales buying?"), undefined, {});
  assert.equal(r.success, false);
  assert.match(r.text, /No token address/);
});
