import { Connection } from "@solana/web3.js";

const CONFIRMATION_MS = 60_000;

export async function settle(connection: Connection, sig: string, lastValidBlockHeight: number): Promise<string | null> {
  const status = async (history: boolean) => {
    try {
      return (await connection.getSignatureStatuses([sig], { searchTransactionHistory: history })).value[0] ?? null;
    } catch {
      throw new Error("network: Devnet couldn’t check the transaction result");
    }
  };
  const deadline = Date.now() + CONFIRMATION_MS;
  let seen = false;
  for (;;) {
    const [st, height] = await Promise.all([status(false), connection.getBlockHeight("confirmed").catch(() => 0)]);
    if (st) seen = true;
    if (st?.err) return JSON.stringify(st.err);
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return null;
    if (height > lastValidBlockHeight) {
      const last = await status(true);
      if (last?.err) return JSON.stringify(last.err);
      if (last?.confirmationStatus === "confirmed" || last?.confirmationStatus === "finalized") return null;
      if (!last && !seen) return "expired";
    }
    if (Date.now() >= deadline) throw new Error("network: the transaction result is still unknown");
    await new Promise((r) => setTimeout(r, 1_000));
  }
}
