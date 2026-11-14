import { actions } from "./actions.js";
import { resolveConfig } from "./client.js";

export { actions, tokenRiskVerdictAction, tokenPreTradePackAction, whaleFlowAction, ROUTES, formatVerdict, formatPack, formatWhale } from "./actions.js";
export { callRoute, resolveConfig, createPayingFetch, DEFAULT_BASE_URL } from "./client.js";

/** ElizaOS plugin: token risk verdicts, token pre-trade pack and whale flow from the Trading Signals Toolkit. */
export const tradingSignalsPlugin = {
  name: "trading-signals",
  description: "Pre-trade crypto checks for agents: Base/Solana token risk verdict ($0.01), token pre-trade GO/CAUTION/STOP pack ($0.015) and whale flow ($0.02), paid per call over x402 in USDC from the agent's own wallet, or with a free API key.",
  config: {
    TRADING_SIGNALS_API_KEY: process.env.TRADING_SIGNALS_API_KEY ?? null,
    TRADING_SIGNALS_EVM_PRIVATE_KEY: null,
    TRADING_SIGNALS_SOLANA_PRIVATE_KEY: null,
    TRADING_SIGNALS_MAX_USD_PER_CALL: process.env.TRADING_SIGNALS_MAX_USD_PER_CALL ?? "0.05",
    TRADING_SIGNALS_MAX_USD_PER_DAY: process.env.TRADING_SIGNALS_MAX_USD_PER_DAY ?? "1",
    TRADING_SIGNALS_PREFERRED_NETWORK: process.env.TRADING_SIGNALS_PREFERRED_NETWORK ?? null,
    TRADING_SIGNALS_BASE_URL: process.env.TRADING_SIGNALS_BASE_URL ?? null,
  },
  init: async (_config, runtime) => {
    const cfg = resolveConfig(runtime);
    const mode = cfg.apiKey ? "free/plan API key" : (cfg.evmKey || cfg.solanaKey) ? `x402 wallet (${[cfg.evmKey && "Base", cfg.solanaKey && "Solana"].filter(Boolean).join(" + ")})` : "NOT configured (set TRADING_SIGNALS_API_KEY or a wallet key)";
    const log = runtime?.logger?.info?.bind(runtime.logger) || console.log;
    log(`[trading-signals] ready: ${cfg.baseUrl}, auth ${mode}, cap $${cfg.maxUsdPerCall}/call, $${cfg.maxUsdPerDay}/day`);
  },
  actions,
  providers: [],
  evaluators: [],
  services: [],
};

export default tradingSignalsPlugin;
