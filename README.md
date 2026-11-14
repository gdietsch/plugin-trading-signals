# @gdietsch/plugin-trading-signals

ElizaOS plugin that gives a trading agent three pre-trade checks for Base and Solana tokens, from the [Trading Signals Toolkit](https://signals.incomefather.com):

| Action | What it answers | Price per call |
| --- | --- | --- |
| `TOKEN_RISK_VERDICT` | Is this token safe to buy? **safe / caution / avoid** + A-F grade with reasons: mint/freeze authority, honeypot or live sell test, LP lock/burn, top-10 holder concentration, sniper and bundle wallets, contract flags. Base ERC-20 or Solana SPL / Token-2022. | $0.01 |
| `TOKEN_PRE_TRADE_PACK` | One **GO / CAUTION / STOP**: token verdict + OFAC sanctions screen of the token's authorities/owner and an optional counterparty wallet + that wallet's USDC pay-readiness. | $0.015 |
| `WHALE_FLOW` | Are big wallets **accumulating or dumping**? Large DEX trades over the last 1-24h: whale buy vs sell USD, net flow and % of liquidity, accumulation/distribution signal, top wallets. | $0.02 |

No signup needed. The agent pays per call over [x402](https://x402.org) in USDC from **its own** wallet on Base or Solana, or uses a free API key (100 calls/month).

> Heuristic on-chain data, not a security audit. **Not financial advice.** Do your own research before trading.

## Install

```bash
bun add @gdietsch/plugin-trading-signals
# or
npm i @gdietsch/plugin-trading-signals
```

Add it to your character:

```json
{
  "name": "PreTradeGuard",
  "plugins": ["@elizaos/plugin-sql", "@elizaos/plugin-openai", "@gdietsch/plugin-trading-signals"]
}
```

Or in code:

```ts
import tradingSignalsPlugin from "@gdietsch/plugin-trading-signals";

export const character = { name: "PreTradeGuard", plugins: [] };
export const projectAgent = { character, plugins: [tradingSignalsPlugin] };
```

A fuller character is in [`examples/character.json`](examples/character.json).

## Configure

Set **one** of these in `.env` or in your character's `settings.secrets` (see [`.env.example`](.env.example)):

| Setting | Use |
| --- | --- |
| `TRADING_SIGNALS_API_KEY` | Free key (100 calls/month) or plan key from [signals.incomefather.com/pricing](https://signals.incomefather.com/pricing). Used first, no wallet payment. If its monthly quota runs out and a wallet is also set, calls fall back to x402. |
| `TRADING_SIGNALS_EVM_PRIVATE_KEY` | Pay in USDC on **Base**. Falls back to `EVM_PRIVATE_KEY`. |
| `TRADING_SIGNALS_SOLANA_PRIVATE_KEY` | Pay in USDC on **Solana** (base58 or JSON byte array). Falls back to `SOLANA_PRIVATE_KEY`. |

Optional:

| Setting | Default |
| --- | --- |
| `TRADING_SIGNALS_MAX_USD_PER_CALL` | `0.05`: payments above this are refused before signing |
| `TRADING_SIGNALS_MAX_USD_PER_DAY` | `1`: per-process daily budget, resets at 00:00 UTC |
| `TRADING_SIGNALS_PREFERRED_NETWORK` | `base` (or `solana`) when both wallets are set |
| `TRADING_SIGNALS_SOLANA_RPC_URL` | falls back to `SOLANA_RPC_URL`, then public mainnet RPC |
| `TRADING_SIGNALS_BASE_URL` | `https://signals.incomefather.com` |

**Wallet safety.** Use a dedicated wallet holding a few dollars of USDC, not your main trading wallet. The facilitator pays gas, so no ETH or SOL is needed. The key only signs x402 payment authorizations locally. It is never logged or sent anywhere, and the plugin only pays USDC on Base or Solana mainnet, within your caps. Calls that fail (4xx/5xx) are not charged.

## Use

The planner picks the action from the conversation. Addresses are read from action parameters (ElizaOS 2.x) or from the message text (1.x). Example conversation (whale numbers are illustrative):

```
you:   is DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 safe to buy?
agent: Token risk verdict for Bonk (DezXAZ8z…B263) on solana: SAFE (grade A).
       - Largest non-pool holder owns 10.4% of supply
       Heuristic data, not financial advice. Paid $0.01 USDC (https://basescan.org/tx/0x…).

you:   are whales dumping 0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed in the last 6 hours?
agent: Whale flow for DEGEN (0x4ed4…efed), last 6h: distribution. 2 whale buys $12,000 vs 9 sells $88,000, net $-76,000 (-3.1% of liquidity), 7 wallets.
```

Each action returns an `ActionResult` with the full JSON response in `data.response` (holders, snipers, LP lock, largest trades, top accumulators and so on) and the payment receipt in `data.payment`, so later actions in the same turn can use it.

Chain is detected from the address format (`0x…` = Base, base58 = Solana). Parameters:

- `TOKEN_RISK_VERDICT`: `token`, `chain`
- `TOKEN_PRE_TRADE_PACK`: `token`, `chain`, `wallet`, `amount` (USDC)
- `WHALE_FLOW`: `token`, `chain`, `hours` (1-24), `minUsd`

You can also call the client without an agent: see [`examples/direct-call.mjs`](examples/direct-call.mjs).

## Compatibility

Plain ESM with no build step. The actions and plugin type-check against `@elizaos/core` 1.7 and 2.0. Node 20+.

## Tests

```bash
npm test              # unit tests, mocked network
LIVE=1 npm test       # also checks the live 402 offers and signs a payment from a throwaway, unfunded wallet on Base and Solana (nothing is charged)
```

## Other ways to use the same API

- Hosted MCP server: `https://signals.incomefather.com/mcp` (Claude, ChatGPT, Cursor)
- npm MCP server: [`x402-trading-signals-mcp`](https://www.npmjs.com/package/x402-trading-signals-mcp)
- Full route catalog: [signals.incomefather.com/catalog](https://signals.incomefather.com/catalog), plus the [token safety guide](https://signals.incomefather.com/guides/solana-token-safety-check-api)

## Disclaimer

Results are automated heuristics from public on-chain and government data. They can be wrong or incomplete, are not a security audit, and are **not financial, investment, legal or tax advice**. You are responsible for your own trades and for any funds in the wallet you configure.

## License

MIT
