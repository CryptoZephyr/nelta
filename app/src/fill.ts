import { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";

export const FILL_ERROR = /0x1891|6289|SuccessCondition/i;
const EXPIRY_MARGIN_BLOCKS = 20;

export async function sendWhenFillable(
  connection: Connection,
  signed: Transaction,
  lastValidBlockHeight: number,
  nextOracleUpdate: () => Promise<void>,
  onBroadcast: () => void,
): Promise<string | null> {
  const raw = signed.serialize();
  const versioned = VersionedTransaction.deserialize(raw);
  while ((await connection.getBlockHeight("confirmed")) < lastValidBlockHeight - EXPIRY_MARGIN_BLOCKS) {
    await nextOracleUpdate();
    const sim = await connection.simulateTransaction(versioned, { sigVerify: false, commitment: "processed" });
    const err = sim.value.err ? JSON.stringify(sim.value.err) : null;
    if (sim.value.err === "BlockhashNotFound") return null;
    if (err && FILL_ERROR.test(err)) continue;
    if (err) throw new Error(err);
    onBroadcast();
    return await connection.sendRawTransaction(raw, { skipPreflight: true });
  }
  return null;
}
