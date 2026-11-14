/** Pull token / wallet addresses and simple options out of free text (fallback when the runtime gives no parameters). */
export const EVM_RE = /0x[0-9a-fA-F]{40}/g;
export const SOL_RE = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g;

export function findAddresses(text = "") {
  const out = [];
  const t = String(text);
  for (const m of t.matchAll(EVM_RE)) out.push({ address: m[0], chain: "base", index: m.index });
  const stripped = t.replace(EVM_RE, (x) => " ".repeat(x.length));
  for (const m of stripped.matchAll(SOL_RE)) {
    // require at least one digit or mixed case so plain long words never match
    if (/[0-9]/.test(m[0]) || (/[a-z]/.test(m[0]) && /[A-Z]/.test(m[0]))) out.push({ address: m[0], chain: "solana", index: m.index });
  }
  return out.sort((a, b) => a.index - b.index).map(({ address, chain }) => ({ address, chain }));
}

export function detectChain(address) {
  if (/^0x[0-9a-fA-F]{40}$/.test(address || "")) return "base";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address || "")) return "solana";
  return null;
}

export function findHours(text = "") {
  const m = String(text).match(/(\d{1,2})\s*(?:h|hr|hrs|hour|hours)\b/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 1 && n <= 24 ? n : undefined;
}

export function findAmount(text = "") {
  const m = String(text).match(/\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*usdc\b/i);
  if (!m) return undefined;
  const n = Number(m[1] ?? m[2]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Merge ElizaOS action parameters (v2: options.parameters) with message-text fallbacks. */
export function readParams(message, options) {
  const p = (options && typeof options === "object" && options.parameters && typeof options.parameters === "object") ? options.parameters : {};
  const text = message?.content?.text || "";
  return { p, text, addrs: findAddresses(text) };
}
