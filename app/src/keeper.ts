import { Connection, PublicKey } from "@solana/web3.js";

/** Fee-payer key of the hosted Nelta keeper (GitHub Actions). Any wallet can run a keeper; this one is ours. */
export const KEEPER = new PublicKey("7kCrKbJ9hAjLFdY26HY5asutdJ4XYadZKajYbu1diqTx");
/** The keeper signs a heartbeat every 10 minutes; allow for missed beats and the gap between hosted runs. */
const ONLINE_WITHIN_SECS = 25 * 60;

export interface KeeperStatus {
  online: boolean | null;
  lastSeenTs: number | null;
}

export async function keeperStatus(connection: Connection): Promise<KeeperStatus> {
  const sigs = await connection.getSignaturesForAddress(KEEPER, { limit: 1 }).catch(() => null);
  if (!sigs) return { online: null, lastSeenTs: null };
  const ts = sigs[0]?.blockTime ?? null;
  return { online: ts !== null && Date.now() / 1000 - ts < ONLINE_WITHIN_SECS, lastSeenTs: ts };
}
