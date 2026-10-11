import { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";
import { SolanaMobileWalletAdapterProtocolErrorCode } from "@solana-mobile/mobile-wallet-adapter-protocol";
import idl from "./nelta.json";
import type { Phase } from "./store";

export const FILL_ERROR = /0x1891|6289|SuccessCondition/i;
const EXPIRY_MARGIN_BLOCKS = 20;
const WALLET_REFUSED = new Set<number>([
  SolanaMobileWalletAdapterProtocolErrorCode.ERROR_INVALID_PAYLOADS,
  SolanaMobileWalletAdapterProtocolErrorCode.ERROR_NOT_SIGNED,
]);
const WALLET_GONE = new Set(["ERROR_SESSION_TIMEOUT", "ERROR_SESSION_CLOSED", "ERROR_ASSOCIATION_CANCELLED"]);

export class NoFill extends Error {}

export function explain(e: unknown, sent: boolean, priorFailedSend = false): Extract<Phase, { kind: "failed" }> {
  const raw = e instanceof Error ? e.message : JSON.stringify(e);
  const earlier = priorFailedSend ? "Earlier tries failed on Devnet and can still cost network fees. " : "";
  const unsent = priorFailedSend ? `The last try wasn’t sent. ${earlier.trim()}` : "Nothing was sent.";
  const unsigned = priorFailedSend ? unsent : "Nothing was signed or sent.";
  if (e instanceof NoFill)
    return { kind: "failed", title: "Velocity couldn’t fill the order", body: "Your SOL and hedge stayed as they were. Any failed attempts sent to Devnet can still cost network fees. Try later; another attempt isn’t guaranteed to fill.", nothingChanged: true };
  const code = (e as { code?: unknown } | null)?.code;
  if (!sent && (WALLET_GONE.has(String(code)) || /session.*(timed? ?out|closed)/i.test(raw)))
    return {
      kind: "failed",
      title: "Your wallet didn’t answer in time",
      body: `${unsigned} Keep your wallet unlocked and Power saving off, then try again.`,
      nothingChanged: true,
    };
  if (!sent && String(code) === String(SolanaMobileWalletAdapterProtocolErrorCode.ERROR_AUTHORIZATION_FAILED))
    return {
      kind: "failed",
      title: "Your wallet asked to connect again",
      body: `${unsigned} Tap Try again and approve the connection in your wallet first.`,
      nothingChanged: true,
    };
  if (!sent && WALLET_REFUSED.has(Number(code)))
    return {
      kind: "failed",
      title: "Your wallet couldn’t send this",
      body: `Nothing changed. ${earlier}Check your wallet has Devnet SOL for fees and is on Devnet, then try again.`,
      nothingChanged: true,
    };
  if (!sent && /declin|reject|cancel|not authori[sz]ed|authorization/i.test(raw))
    return {
      kind: "failed",
      title: "Your wallet didn’t sign",
      body: `${unsigned} If your wallet was locked, open and unlock it first, then try again.`,
      nothingChanged: true,
    };
  const custom = /"Custom":(\d+)|custom program error: 0x([0-9a-f]+)/i.exec(raw);
  if (custom) {
    const n = custom[1] ? Number(custom[1]) : parseInt(custom[2], 16);
    const msg = idl.errors.find((x) => x.code === n)?.msg;
    if (msg) return { kind: "failed", title: "Nelta stopped this", body: `${msg}. The whole transaction was undone; nothing moved except the network fee.`, nothingChanged: true };
  }
  if (/429|fetch failed|network|timed? ?out/i.test(raw))
    return {
      kind: "failed",
      title: "Couldn’t reach Devnet",
      body: sent ? "It may still land. Check Activity before trying again." : `${unsent} Try again in a moment.`,
      nothingChanged: !sent,
    };
  return {
    kind: "failed",
    title: sent ? "Check the transaction result" : "Couldn’t prepare this transaction",
    body: sent ? "It may still land. Check Activity before trying again." : `${unsent} Check your connection and try again.`,
    nothingChanged: !sent,
  };
}

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
