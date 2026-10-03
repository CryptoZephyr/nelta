import { Connection, PublicKey } from "@solana/web3.js";

/** Fee-payer key of the hosted Nelta keeper (GitHub Actions). Any wallet can run a keeper; this one is ours. */
export const KEEPER = new PublicKey("7kCrKbJ9hAjLFdY26HY5asutdJ4XYadZKajYbu1diqTx");
const RUNS = "https://api.github.com/repos/CryptoZephyr/nelta/actions/workflows/keeper.yml/runs?per_page=1&status=in_progress";

export interface KeeperStatus {
  online: boolean | null;
  lastActionTs: number | null;
}

export async function keeperStatus(connection: Connection): Promise<KeeperStatus> {
  const [run, sigs] = await Promise.all([
    fetch(RUNS, { headers: { Accept: "application/vnd.github+json" } })
      .then(async (r) => (r.ok ? ((await r.json()) as { total_count: number }).total_count > 0 : null))
      .catch(() => null),
    connection.getSignaturesForAddress(KEEPER, { limit: 1 }).catch(() => []),
  ]);
  return { online: run, lastActionTs: sigs[0]?.blockTime ?? null };
}
