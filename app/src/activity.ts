import { Connection, PublicKey } from "@solana/web3.js";
import idl from "./nelta.json";

export interface Activity {
  sig: string;
  ts: number | null;
  ok: boolean;
  by: "you" | "keeper";
  what: string;
}

const NAMES: Record<string, string> = {
  Initialize: "Position created",
  Deposit: "Deposit",
  Rebalance: "Hedge synced",
  ReduceHedge: "Close-hedge order placed",
  Release: "Released with hedge",
  WithdrawCollateral: "Collateral withdrawn",
  SetRule: "Rule armed",
  RevokeRule: "Rule revoked",
  ExecuteRule: "Rule ran",
  SetRatio: "Hedge ratio changed",
};

const PROGRAM = idl.address;

function describe(logs: string[]): string {
  const names: string[] = [];
  let depth = 0;
  for (const l of logs) {
    if (l.startsWith(`Program ${PROGRAM} invoke`)) depth++;
    else if (l.startsWith(`Program ${PROGRAM} success`) || l.startsWith(`Program ${PROGRAM} failed`)) depth--;
    else if (depth > 0) {
      const m = /^Program log: Instruction: (\w+)$/.exec(l);
      if (m && NAMES[m[1]] && !names.includes(NAMES[m[1]])) names.push(NAMES[m[1]]);
    }
  }
  return names.join(" + ") || "Retry account setup";
}

export async function activity(connection: Connection, position: PublicKey, owner: PublicKey): Promise<Activity[]> {
  const sigs = await connection.getSignaturesForAddress(position, { limit: 15 });
  if (!sigs.length) return [];
  const txs = await connection.getTransactions(
    sigs.map((s) => s.signature),
    { maxSupportedTransactionVersion: 0, commitment: "confirmed" },
  );
  return sigs.map((s, i) => {
    const tx = txs[i];
    const payer = tx?.transaction.message.staticAccountKeys[0];
    return {
      sig: s.signature,
      ts: s.blockTime ?? null,
      ok: !s.err,
      by: payer && !payer.equals(owner) ? "keeper" : "you",
      what: describe(tx?.meta?.logMessages ?? []),
    };
  });
}
