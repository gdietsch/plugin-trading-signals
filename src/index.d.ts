import type { Action, Plugin } from "@elizaos/core";

export interface TradingSignalsRoute { path: string; price: number }
export declare const ROUTES: Readonly<{ baseVerdict: TradingSignalsRoute; solanaVerdict: TradingSignalsRoute; tokenPack: TradingSignalsRoute; whaleFlow: TradingSignalsRoute }>;
export declare const tokenRiskVerdictAction: Action;
export declare const tokenPreTradePackAction: Action;
export declare const whaleFlowAction: Action;
export declare const actions: Action[];
export declare const DEFAULT_BASE_URL: string;

export interface TradingSignalsConfig {
  baseUrl: string; apiKey: string; evmKey: string; solanaKey: string; solanaRpcUrl: string;
  preferred: "" | "base" | "solana"; maxUsdPerCall: number; maxUsdPerDay: number; timeoutMs: number;
}
export interface CallResult {
  ok: boolean; status?: number; data?: unknown; via?: "api_key" | "x402"; quotaRemaining?: string | null;
  payment?: { priceUsd: number; success?: boolean; network?: string; transaction?: string; explorer?: string } | null;
  error?: string; message?: string;
}
export declare function resolveConfig(runtime?: { getSetting?: (key: string) => unknown }, env?: Record<string, string | undefined>): TradingSignalsConfig;
export declare function callRoute(route: TradingSignalsRoute, params: Record<string, unknown>, cfg: TradingSignalsConfig, deps?: { fetch?: typeof fetch; payingFetch?: { fetch: typeof fetch; payers?: Record<string, string> } }): Promise<CallResult>;
export declare function createPayingFetch(cfg: TradingSignalsConfig, baseFetch?: typeof fetch): Promise<{ fetch: typeof fetch; payers: Record<string, string> } | null>;
export declare function formatVerdict(data: unknown, address: string, chain: string): string;
export declare function formatPack(data: unknown, address: string): string;
export declare function formatWhale(data: unknown, address: string, hours?: number): string;

export declare const tradingSignalsPlugin: Plugin;
export default tradingSignalsPlugin;
