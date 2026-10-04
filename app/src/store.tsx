import { Connection, NonceAccount, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Nelta, RPC, Snapshot, SOL_ORACLE } from "./nelta";
import idl from "./nelta.json";
import { connect, disconnect, signAndSend, signBatch } from "./wallet";

export const connection = new Connection(RPC, "confirmed");
const FILL_ATTEMPTS = 40;
const NONCES = 4;
const SIGN_ROUNDS = 3;
const FILL_ERROR = /0x1891|6289|SuccessCondition/i;

export interface Change {
  label: string;
  from?: string;
  to: string;
}

/** Everything the user sees before signing: what changes, and what can’t happen. */
export interface Plan {
  title: string;
  summary: string;
  changes: Change[];
  notes?: string[];
  fill?: boolean;
  ixs: (n: Nelta) => Promise<TransactionInstruction[]>;
}

export type Phase =
  | { kind: "preview" }
  | { kind: "wallet"; why: string }
  | { kind: "confirming"; sig?: string }
  | { kind: "filling"; attempt: number; max: number; set: number; sets: number }
  | { kind: "done"; sig: string }
  | { kind: "failed"; title: string; body: string; nothingChanged: boolean };

export class NoFill extends Error {}

/** Polls rather than subscribes: websocket subscriptions are unreliable on mobile networks. */
async function nextOracleUpdate(timeoutMs = 6_000): Promise<void> {
  const read = async () => (await connection.getAccountInfo(SOL_ORACLE, "processed").catch(() => null))?.data;
  let sub: number | undefined;
  let done = false;
  const pushed = new Promise<void>((resolve) => {
    sub = connection.onAccountChange(SOL_ORACLE, () => resolve(), { commitment: "processed" });
  });
  const polled = (async () => {
    const start = await read();
    const deadline = Date.now() + timeoutMs;
    while (!done && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
      const now = await read();
      if (start && now && !now.equals(start)) return;
    }
  })();
  try {
    await Promise.race([pushed, polled]);
  } finally {
    done = true;
    if (sub !== undefined) void connection.removeAccountChangeListener(sub).catch(() => undefined);
  }
}

/**
 * Resubmits one durable-nonce transaction on each oracle update until it fills. Preflight-rejected attempts never land,
 * so the same signature stays valid; returns null if an attempt landed unfilled (reverted whole, nonce consumed).
 */
async function submitUntilFilled(tx: Transaction, attempts: number, onAttempt: (n: number) => void): Promise<string | null> {
  const raw = tx.serialize();
  let last = "no attempts";
  for (let i = 1; i <= attempts; i++) {
    onAttempt(i);
    await nextOracleUpdate();
    let sig: string;
    try {
      sig = await connection.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "processed" });
    } catch (e) {
      last = (e instanceof Error ? e.message : JSON.stringify(e)).slice(0, 160);
      if (!/0x1891|SuccessCondition|fetch failed|network|429/i.test(last)) throw new Error(last);
      continue;
    }
    for (let k = 0; k < 30; k++) {
      const st = (await connection.getSignatureStatus(sig).catch(() => null))?.value;
      if (st?.err) {
        const err = JSON.stringify(st.err);
        if (FILL_ERROR.test(err)) return null;
        throw new Error(err);
      }
      if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return sig;
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  throw new NoFill(`No fill after ${attempts} attempts (${last})`);
}

/** Turns wallet, RPC and program errors into plain words, and says whether anything could have changed. */
function explain(e: unknown, sent: boolean): Extract<Phase, { kind: "failed" }> {
  const raw = e instanceof Error ? e.message : JSON.stringify(e);
  if (e instanceof NoFill)
    return { kind: "failed", title: "No fill this time", body: "Velocity didn’t fill it while the price feed was fresh. Nothing changed. Try again in a minute.", nothingChanged: true };
  if (!sent && /declin|reject|cancel|not authori[sz]ed|authorization/i.test(raw))
    return { kind: "failed", title: "Cancelled in your wallet", body: "Nothing was signed or sent.", nothingChanged: true };
  const code = /"Custom":(\d+)|custom program error: 0x([0-9a-f]+)/i.exec(raw);
  if (code) {
    const n = code[1] ? Number(code[1]) : parseInt(code[2], 16);
    const msg = idl.errors.find((x) => x.code === n)?.msg;
    if (msg) return { kind: "failed", title: "Nelta stopped this", body: `${msg}. The whole transaction was undone; nothing moved except the network fee.`, nothingChanged: true };
  }
  if (/429|fetch failed|network|timed? ?out/i.test(raw))
    return {
      kind: "failed",
      title: "Couldn’t reach Devnet",
      body: sent ? "It may still land. Check Activity before trying again." : "Nothing was sent. Try again in a moment.",
      nothingChanged: !sent,
    };
  return { kind: "failed", title: "Something went wrong", body: raw.slice(0, 180), nothingChanged: false };
}

interface Store {
  owner: PublicKey | null;
  nelta: Nelta | null;
  snap: Snapshot | null;
  readError: string | null;
  refresh: () => Promise<void>;
  connecting: boolean;
  connectError: string | null;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  flow: { plan: Plan; phase: Phase } | null;
  propose: (plan: Plan) => void;
  approve: () => Promise<void>;
  dismiss: () => void;
  version: number;
}

const Ctx = createContext<Store | null>(null);

export function useNelta(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useNelta outside NeltaProvider");
  return s;
}

export function NeltaProvider({ children }: { children: React.ReactNode }) {
  const [owner, setOwner] = useState<PublicKey | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [flow, setFlow] = useState<{ plan: Plan; phase: Phase } | null>(null);
  const [version, setVersion] = useState(0);
  const running = useRef(false);
  const nelta = useMemo(() => (owner ? new Nelta(connection, owner) : null), [owner]);

  const refresh = useCallback(async () => {
    if (!nelta) return;
    try {
      setSnap(await nelta.snapshot());
      setReadError(null);
    } catch (e) {
      setReadError((e as Error).message);
    }
  }, [nelta]);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const id = setInterval(() => {
      if (!running.current) void refresh();
    }, 10_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);

  const connectWallet = useCallback(async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      setOwner(await connect());
    } catch (e) {
      setConnectError(explain(e, false).title);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnectWallet = useCallback(() => {
    disconnect();
    setOwner(null);
    setSnap(null);
  }, []);

  const propose = useCallback((plan: Plan) => setFlow({ plan, phase: { kind: "preview" } }), []);
  const dismiss = useCallback(() => {
    if (!running.current) setFlow(null);
  }, []);

  const approve = useCallback(async () => {
    if (!flow || !nelta || running.current) return;
    const { plan } = flow;
    const set = (phase: Phase) => setFlow({ plan, phase });
    running.current = true;
    let sent = false;
    try {
      let sig: string;
      if (!plan.fill) {
        set({ kind: "wallet", why: "Approve one transaction in your wallet." });
        const { blockhash } = await connection.getLatestBlockhash();
        sig = await signAndSend(async () => nelta.tx(await plan.ixs(nelta), blockhash));
        sent = true;
        set({ kind: "confirming", sig });
        const res = await connection.confirmTransaction(sig, "confirmed");
        if (res.value.err) throw new Error(JSON.stringify(res.value.err));
      } else {
        sig = await fillLoop(nelta, plan, set, () => {
          sent = true;
        });
      }
      set({ kind: "done", sig });
    } catch (e) {
      set(explain(e, sent));
    } finally {
      running.current = false;
      await refresh();
      setVersion((v) => v + 1);
    }
  }, [flow, nelta, refresh]);

  const value: Store = { owner, nelta, snap, readError, refresh, connecting, connectError, connectWallet, disconnectWallet, flow, propose, approve, dismiss, version };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

async function fillLoop(n: Nelta, plan: Plan, set: (p: Phase) => void, onSent: () => void): Promise<string> {
  const addrs = await Promise.all(Array.from({ length: NONCES }, (_, i) => n.nonceAddress(i)));
  const missing = (await connection.getMultipleAccountsInfo(addrs)).flatMap((a, i) => (a ? [] : [i]));
  if (missing.length) {
    set({ kind: "wallet", why: "One-time setup: approve the retry accounts, so later you sign once instead of on every try." });
    const { blockhash } = await connection.getLatestBlockhash();
    const sig = await signAndSend(async () => n.tx(await n.createNonceIxs(missing), blockhash));
    set({ kind: "confirming", sig });
    const res = await connection.confirmTransaction(sig, "confirmed");
    if (res.value.err) throw new Error(JSON.stringify(res.value.err));
  }
  for (let round = 1; round <= SIGN_ROUNDS; round++) {
    const infos = await connection.getMultipleAccountsInfo(addrs, "confirmed");
    const nonces = infos.map((a) => {
      if (!a) throw new Error("Retry account missing");
      return NonceAccount.fromAccountData(a.data).nonce;
    });
    const built = await plan.ixs(n);
    set({
      kind: "wallet",
      why: round === 1 ? "Approve a few signed tries at once. Each try either fills fully or changes nothing." : "Those tries ran out. Approve a fresh set to keep trying.",
    });
    const signed = await signBatch(NONCES, async (_, count) => nonces.slice(0, count).map((nonce, i) => n.durableTx(built, addrs[i], nonce, addrs)));
    onSent();
    for (const [i, t] of signed.entries()) {
      const sig = await submitUntilFilled(t, FILL_ATTEMPTS, (attempt) =>
        set({ kind: "filling", attempt: i * FILL_ATTEMPTS + attempt, max: signed.length * FILL_ATTEMPTS, set: round, sets: SIGN_ROUNDS }),
      );
      if (sig) return sig;
    }
  }
  throw new NoFill("Velocity didn’t fill in time");
}
