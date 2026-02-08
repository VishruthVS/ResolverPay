const API_BASE = "https://resolverpay-tt47v.ondigitalocean.app/api";

export async function createIntent(data: {
  from: string;
  to: string;
  amount: number;
  minOutput: number;
  deadlineSeconds: number;
}) {
  const res = await fetch(`${API_BASE}/intent/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function fetchOpenIntents(limit = 50, includeExpired = false) {
  const res = await fetch(`${API_BASE}/intents/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ limit, includeExpired }),
  });
  return res.json();
}

export async function executeIntent(intentId: string) {
  const res = await fetch(`${API_BASE}/intent/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intentId }),
  });
  return res.json();
}

export function parseTokenName(typeStr: string): string {
  const parts = typeStr.split("::");
  return parts[parts.length - 1]?.toUpperCase() || typeStr;
}

export function msToHumanTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export const TOKENS = [
  { symbol: "SUI", name: "Sui" },
  { symbol: "USDC", name: "USD Coin" },
  { symbol: "ETH", name: "Ethereum" },
  { symbol: "BTC", name: "Bitcoin" },
  { symbol: "USDT", name: "Tether" },
];
