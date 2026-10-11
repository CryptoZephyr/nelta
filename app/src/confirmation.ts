import { Connection } from "@solana/web3.js";
import type { Phase, Plan } from "./store";
import type { TutorialAttempt } from "./tutorial";

const CONFIRMATION_MS = 60_000;

async function beforeDeadline<T>(read: Promise<T>, deadline: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("network: the transaction result is still unknown")), Math.max(0, deadline - Date.now()));
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function settle(connection: Connection, sig: string, lastValidBlockHeight: number, onConfirmed?: (slot: number) => void): Promise<string | null> {
  const deadline = Date.now() + CONFIRMATION_MS;
  const status = async (history: boolean) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return (await beforeDeadline(connection.getSignatureStatuses([sig], { searchTransactionHistory: history }), deadline)).value[0] ?? null;
      } catch {
        if (attempt >= 2 || Date.now() >= deadline) throw new Error("network: Devnet couldn’t check the transaction result");
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }
  };
  let seen = false;
  for (;;) {
    const st = await status(false);
    if (st) seen = true;
    if (st?.err) return JSON.stringify(st.err);
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") {
      onConfirmed?.(st.slot);
      return null;
    }
    const height = await beforeDeadline(connection.getBlockHeight("confirmed"), deadline).catch(() => 0);
    if (height > lastValidBlockHeight) {
      const last = await status(true);
      if (last?.err) return JSON.stringify(last.err);
      if (last?.confirmationStatus === "confirmed" || last?.confirmationStatus === "finalized") {
        onConfirmed?.(last.slot);
        return null;
      }
      if (!last && !seen) return "expired";
    }
    if (Date.now() >= deadline) throw new Error("network: the transaction result is still unknown");
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

export async function resolveReceipt(connection: Connection, recent: TutorialAttempt, at: number): Promise<TutorialAttempt> {
  if (!recent.sig || recent.phase.kind !== "failed" || recent.phase.nothingChanged) return recent;
  try {
    const status = (await beforeDeadline(connection.getSignatureStatuses([recent.sig], { searchTransactionHistory: true }), Date.now() + 5000)).value[0];
    if (!status || (status.confirmationStatus !== "confirmed" && status.confirmationStatus !== "finalized")) return recent;
    return {
      ...recent,
      at,
      slot: status.slot,
      phase: status.err
        ? { kind: "failed", title: "Transaction failed", body: "The confirmed receipt shows that the transaction failed. Your position is unchanged except for fees.", nothingChanged: true }
        : { kind: "done", sig: recent.sig },
    };
  } catch {
    return recent;
  }
}

export function resolveReceiptFlow(flow: { plan: Plan; phase: Phase } | null, previous: TutorialAttempt, resolved: TutorialAttempt) {
  return flow?.phase === previous.phase && previous.owner === resolved.owner && previous.sig === resolved.sig
    ? { ...flow, phase: resolved.phase } : flow;
}
