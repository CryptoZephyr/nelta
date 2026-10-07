import { LAMPORTS } from "./nelta";

export const sol = (lamports: bigint | number, dp = 4) => (Number(lamports) / LAMPORTS).toFixed(dp);
export const usd = (n: number) => `$${n.toFixed(2)}`;
export const short = (s: string, n = 4) => `${s.slice(0, n)}…${s.slice(-n)}`;
export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const toLamports = (s: string): bigint | null => {
  const n = Number(s);
  const lamports = Math.round(n * LAMPORTS);
  return Number.isSafeInteger(lamports) && lamports > 0 ? BigInt(lamports) : null;
};

export function ago(unixSecs: number): string {
  const d = Math.max(0, Math.floor(Date.now() / 1000) - unixSecs);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return `${Math.floor(d / 86400)} d ago`;
}

export function until(unixSecs: number): string {
  const d = Math.max(0, unixSecs - Math.floor(Date.now() / 1000));
  if (d < 3600) return `${Math.max(1, Math.floor(d / 60))} min`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ${Math.floor((d % 3600) / 60)} min`;
  return `${Math.floor(d / 86400)} d ${Math.floor((d % 86400) / 3600)} h`;
}

export function age(secs: number): string {
  if (secs < 90) return `${secs}s`;
  if (secs < 5400) return `${Math.round(secs / 60)} min`;
  return `${Math.round(secs / 3600)} h`;
}
