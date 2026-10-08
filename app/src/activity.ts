import { Connection, PublicKey, VersionedMessage, VersionedTransactionResponse } from "@solana/web3.js";
import idl from "./nelta.json";

export interface Activity {
  sig: string;
  ts: number | null;
  ok: boolean;
  by: "you" | "keeper";
  what: string;
}

const NAMES: Record<string, string> = {
  initialize: "Position created",
  deposit: "Deposit",
  rebalance: "Hedge synced",
  reduce_hedge: "Close-hedge order placed",
  release: "Released with hedge",
  withdraw_collateral: "Collateral withdrawn",
  set_rule: "Rule armed",
  revoke_rule: "Rule revoked",
  execute_rule: "Rule ran",
  set_ratio: "Hedge ratio changed",
};

const PROGRAM = idl.address;

export function describeTransaction(message: VersionedMessage): string {
  const names: string[] = [];
  for (const ix of message.compiledInstructions) {
    if (message.staticAccountKeys[ix.programIdIndex]?.toBase58() !== PROGRAM) continue;
    const instruction = idl.instructions.find((entry) =>
      entry.discriminator.every((byte, i) => ix.data[i] === byte),
    );
    const name = instruction && NAMES[instruction.name];
    if (name && !names.includes(name)) names.push(name);
  }
  return names.join(" + ") || "Account setup";
}

export async function activity(connection: Connection, position: PublicKey, owner: PublicKey): Promise<Activity[]> {
  const sigs = await connection.getSignaturesForAddress(position, { limit: 15 });
  if (!sigs.length) return [];
  const items: Activity[] = [];
  for (const s of sigs) {
    const read = () => connection.getTransaction(
      s.signature,
      { maxSupportedTransactionVersion: 0, commitment: "confirmed" },
    );
    let tx: VersionedTransactionResponse | null;
    try {
      tx = await read();
    } catch (e) {
      if (!(e instanceof Error) || !/429|too many requests/i.test(e.message)) throw e;
      tx = await read();
    }
    const payer = tx?.transaction.message.staticAccountKeys[0];
    items.push({
      sig: s.signature,
      ts: s.blockTime ?? null,
      ok: !s.err,
      by: payer && !payer.equals(owner) ? "keeper" : "you",
      what: tx ? describeTransaction(tx.transaction.message) : "Transaction details unavailable",
    });
  }
  return items;
}
