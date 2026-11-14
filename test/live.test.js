// Live checks against https://signals.incomefather.com. Run with LIVE=1 npm test.
// Uses throwaway, never-funded keys generated in memory: proves the x402 client signs a
// valid payment for the live 402 offer on Base and Solana, and that nothing is charged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { callRoute, resolveConfig, ROUTES } from "../src/index.js";

const LIVE = process.env.LIVE === "1";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

test("live routes answer 402 with Base and Solana USDC offers", { skip: !LIVE }, async () => {
  for (const [route, q] of [[ROUTES.solanaVerdict, `mint=${BONK}`], [ROUTES.tokenPack, `token=${BONK}`], [ROUTES.whaleFlow, `token=${BONK}`]]) {
    const res = await fetch(`https://signals.incomefather.com${route.path}?${q}`);
    assert.equal(res.status, 402, route.path);
    const pr = JSON.parse(Buffer.from(res.headers.get("payment-required"), "base64").toString());
    const nets = pr.accepts.map((a) => a.network);
    assert.ok(nets.includes("eip155:8453") && nets.some((n) => n.startsWith("solana:")), route.path);
    const amt = Number(pr.accepts[0].amount) / 1e6;
    assert.equal(amt, route.price, route.path);
  }
});

for (const net of ["base", "solana"]) {
  test(`live ${net} x402 payment is signed and rejected for an empty wallet (no charge)`, { skip: !LIVE, timeout: 120000 }, async () => {
    const { generatePrivateKey } = await import("viem/accounts");
    const settings = {};
    if (net === "base") settings.TRADING_SIGNALS_EVM_PRIVATE_KEY = generatePrivateKey();
    else {
      const { webcrypto } = await import("node:crypto");
      const kp = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
      const pkcs8 = new Uint8Array(await webcrypto.subtle.exportKey("pkcs8", kp.privateKey));
      const pub = new Uint8Array(await webcrypto.subtle.exportKey("raw", kp.publicKey));
      settings.TRADING_SIGNALS_SOLANA_PRIVATE_KEY = JSON.stringify([...pkcs8.slice(-32), ...pub]);
      settings.TRADING_SIGNALS_PREFERRED_NETWORK = "solana";
    }
    let signed = false;
    const spy = async (url, init) => {
      const h = new Headers(url instanceof Request ? url.headers : undefined);
      new Headers(init?.headers || {}).forEach((v, k) => h.set(k, v));
      if (h.get("payment-signature") || h.get("x-payment")) signed = true;
      return fetch(url, init);
    };
    const cfg = resolveConfig({ getSetting: (k) => settings[k] }, {});
    const r = await callRoute(ROUTES.solanaVerdict, { mint: BONK }, cfg, { fetch: spy });
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(signed, true, `no payment header sent: ${JSON.stringify(r)}`);
    assert.ok(["payment_not_completed", "request_failed", "api_error"].includes(r.error), JSON.stringify(r));
  });
}
