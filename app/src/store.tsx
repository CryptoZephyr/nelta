import { Connection, PublicKey, Transaction, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Nelta, RPC, Snapshot, SOL_ORACLE } from "./nelta";
import idl from "./nelta.json";
import { Tone } from "./theme";
import { connect, disconnect, signAndSend, signForFill } from "./wallet";

export const connection = new Connection(RPC, "confirmed");
const FILL_TRIES = 10;
const FILL_ERROR = /0x1891|6289|SuccessCondition/i;
const EXPIRY_MARGIN_BLOCKS = 20;

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
  const start = await read();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    const now = await read();
    if (start && now && !now.equals(start)) return;
  }
}

/** Turns wallet, RPC and program errors into plain words, and says whether anything could have changed. */
export interface ConnectIssue {
  tone: Tone;
  title: string;
  body: string;
}

const CONNECT_TIMEOUT_MS = 20_000;

const WALLET_SILENT: ConnectIssue = {
  tone: "drift",
  title: "Your wallet didn’t answer",
  body: "Unlock your wallet first, and turn off Android Power saving. Phantom also stays silent when it isn’t on Devnet: Settings → Developer settings → Testnet mode on, network Solana Devnet. Then tap Connect again.",
};

function connectIssue(e: unknown): ConnectIssue {
  const raw = e instanceof Error ? e.message : JSON.stringify(e);
  if (/ERROR_WALLET_NOT_FOUND|no.*wallet.*found|not found/i.test(raw))
    return { tone: "waiting", title: "No Solana wallet found", body: "Install Phantom or Solflare, switch it to Devnet, then tap Connect again." };
  if (/cluster|chain/i.test(raw) && /support|mismatch|invalid|unknown/i.test(raw)) return WALLET_SILENT;
  const { title } = explain(e, false);
  return { tone: "waiting", title: title === "Something went wrong" ? "Couldn’t connect" : title, body: "Nothing was signed. Try again when you’re ready." };
}

function explain(e: unknown, sent: boolean): Extract<Phase, { kind: "failed" }> {
  const raw = e instanceof Error ? e.message : JSON.stringify(e);
  if (e instanceof NoFill)
    return { kind: "failed", title: "No fill this time", body: "Velocity didn’t fill it while the price feed was fresh. Nothing changed. Try again in a minute.", nothingChanged: true };
  if (!sent && /declin|reject|cancel|not authori[sz]ed|authorization/i.test(raw))
    return {
      kind: "failed",
      title: "Your wallet didn’t sign",
      body: "Nothing was signed or sent. If your wallet was locked, open and unlock it first, then try again.",
      nothingChanged: true,
    };
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
  connectError: ConnectIssue | null;
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
  const [connectError, setConnectError] = useState<ConnectIssue | null>(null);
  const [flow, setFlow] = useState<{ plan: Plan; phase: Phase } | null>(null);
  const [version, setVersion] = useState(0);
  const running = useRef(false);
  const attempt = useRef(0);
  const nelta = useMemo(() => (owner ? new Nelta(connection, owner) : null), [owner]);

  const refresh = useCallback(async () => {
    if (!nelta) return;
    try {
      setSnap(await nelta.snapshot());
      setReadError(null);
    } catch (e) {
      if ((e as Error).name === "InvalidVenueState") setSnap(null);
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
    const id = ++attempt.current;
    const current = () => id === attempt.current;
    setConnecting(true);
    setConnectError(null);
    const slow = setTimeout(() => {
      if (!current()) return;
      attempt.current++;
      setConnecting(false);
      setConnectError(WALLET_SILENT);
    }, CONNECT_TIMEOUT_MS);
    try {
      const who = await connect();
      if (current()) setOwner(who);
    } catch (e) {
      if (current()) setConnectError(connectIssue(e));
    } finally {
      clearTimeout(slow);
      if (current()) setConnecting(false);
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
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        sig = await signAndSend(async () => nelta.tx(await plan.ixs(nelta), blockhash));
        sent = true;
        set({ kind: "confirming", sig });
        const err = await settle(sig, lastValidBlockHeight);
        if (err === "expired") throw new Error("network: the transaction expired before it landed");
        if (err) throw new Error(err);
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

/**
 * Waits until a transaction landed or can no longer land. Returns null on success, the on-chain error as JSON,
 * or "expired" if it never landed. Polls over HTTP; websocket confirmations stall when mobile networks drop the socket.
 */
async function settle(sig: string, lastValidBlockHeight: number): Promise<string | null> {
  const status = async (history: boolean) =>
    (await connection.getSignatureStatuses([sig], { searchTransactionHistory: history }).catch(() => null))?.value[0] ?? null;
  for (;;) {
    const [st, height] = await Promise.all([status(false), connection.getBlockHeight("confirmed").catch(() => 0)]);
    if (st?.err) return JSON.stringify(st.err);
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return null;
    if (height > lastValidBlockHeight) {
      const last = await status(true);
      if (last?.err) return JSON.stringify(last.err);
      return last?.confirmationStatus === "confirmed" || last?.confirmationStatus === "finalized" ? null : "expired";
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

/**
 * Holds a signed try until a simulation right after a price update says Velocity can fill it, then sends it. The
 * fill only works within a few slots of a price update, which is shorter than a wallet approval takes.
 * Returns null if the blockhash ran out first; the try was never sent, so it can never land.
 */
async function sendWhenFillable(signed: Transaction, lastValidBlockHeight: number): Promise<string | null> {
  const raw = signed.serialize();
  const versioned = VersionedTransaction.deserialize(raw);
  while ((await connection.getBlockHeight("confirmed").catch(() => 0)) < lastValidBlockHeight - EXPIRY_MARGIN_BLOCKS) {
    await nextOracleUpdate();
    const sim = await connection.simulateTransaction(versioned, { sigVerify: false, commitment: "processed" }).catch(() => null);
    if (!sim) continue;
    const err = sim.value.err ? JSON.stringify(sim.value.err) : null;
    if (err && FILL_ERROR.test(err)) continue;
    if (err) throw new Error(err);
    return await connection.sendRawTransaction(raw, { skipPreflight: true });
  }
  return null;
}

/**
 * One wallet approval per try. Each try is settled (landed, or its blockhash expired) before the next is signed, so
 * two tries can never both succeed.
 */
async function fillLoop(n: Nelta, plan: Plan, set: (p: Phase) => void, onSent: () => void): Promise<string> {
  for (let attempt = 1; attempt <= FILL_TRIES; attempt++) {
    set({
      kind: "wallet",
      why: attempt === 1
        ? "Approve in your wallet. Your wallet may warn it could fail: if Velocity can’t fill it, it changes nothing."
        : `Try ${attempt - 1} didn’t fill, and nothing changed. Approve another try.`,
    });
    const ixs = await plan.ixs(n);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const signed = await signForFill(async () => n.tx(ixs, blockhash));
    set({ kind: "filling", attempt, max: FILL_TRIES, set: attempt, sets: FILL_TRIES });
    const sig = "sig" in signed ? signed.sig : await sendWhenFillable(signed.signed, lastValidBlockHeight);
    if (sig === null) continue;
    onSent();
    const err = await settle(sig, lastValidBlockHeight);
    if (err === null) return sig;
    if (err !== "expired" && !FILL_ERROR.test(err)) throw new Error(err);
  }
  throw new NoFill("Velocity didn’t fill in time");
}
