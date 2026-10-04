/**
 * Nelta keeper. Holds only a fee-payer key: it cannot sign for owners and the program only pays
 * the owner's wSOL account. All state is read from chain on every oracle tick, so a restart
 * resumes without local state. Usage: tsx src/worker.ts [--once]
 * Env: RPC_URL, NELTA_KEEPER_KEYPAIR (path or JSON byte array), NELTA_MAX_ATTEMPTS (per rule nonce, default 200),
 * NELTA_POLL_MS (oracle poll fallback, default 5000), NELTA_HEARTBEAT_MS (on-chain heartbeat, default 600000).
 */
import { BN } from "@anchor-lang/core";
import { Connection, PublicKey, sendAndConfirmTransaction, SendTransactionError, Transaction, TransactionInstruction } from "@solana/web3.js";
import { loadKeypair } from "@velocity-exchange/sdk";
import { NeltaClient, PositionAccount, SOL_ORACLE, withBudget } from "./client";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const MAX_ATTEMPTS = Number(process.env.NELTA_MAX_ATTEMPTS ?? 200);
const MAX_ORACLE_AGE_SECS = 30;
const POLL_MS = Number(process.env.NELTA_POLL_MS ?? 5_000);
const HEARTBEAT_MS = Number(process.env.NELTA_HEARTBEAT_MS ?? 10 * 60_000);
const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const TERMINAL = /RuleInactive|StaleNonce|RuleExpired|InvalidRecipient|InvalidTokenAccount|InvalidVenueAccount|UnexpectedLong|UnexpectedBorrow/;

const conn = new Connection(RPC, "confirmed");
const keeper = loadKeypair(process.env.NELTA_KEEPER_KEYPAIR ?? `${process.env.HOME}/nelta-day1/keys/owner.json`);
const registry = new NeltaClient(conn, keeper.publicKey, keeper);
const attempts = new Map<string, number>();
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

export interface OraclePrice { price: BN; publishTs: number }

/** Same layout and PRICE_PRECISION (1e6) conversion as the program's read_oracle_price. */
export function parseOracle(data: Buffer): OraclePrice {
  const raw = new BN(data.readBigInt64LE(8).toString());
  const publishTs = Number(data.readBigUInt64LE(16) / 1_000_000n);
  const shift = 6 + data.readInt32LE(32);
  const price = shift >= 0 ? raw.mul(new BN(10).pow(new BN(shift))) : raw.div(new BN(10).pow(new BN(-shift)));
  return { price, publishTs };
}

export function isDue(pos: PositionAccount, o: OraclePrice, now: number): boolean {
  const r = pos.rule;
  if (!r.active || now > r.expiryTs.toNumber() || now - o.publishTs > MAX_ORACLE_AGE_SECS) return false;
  return r.above ? o.price.gte(r.triggerPrice) : o.price.lte(r.triggerPrice);
}

async function positions(): Promise<{ publicKey: PublicKey; account: PositionAccount }[]> {
  const ns = registry.program.account as never as { position: { all(): Promise<{ publicKey: PublicKey; account: PositionAccount }[]> } };
  return ns.position.all();
}

async function execute(pos: PositionAccount, o: OraclePrice): Promise<void> {
  const key = `${pos.owner.toBase58()}:${pos.ruleNonce.toString()}`;
  const n = (attempts.get(key) ?? 0) + 1;
  if (n > MAX_ATTEMPTS) return;
  attempts.set(key, n);
  const nelta = new NeltaClient(conn, pos.owner, keeper);
  const ix = await nelta.executeRuleIx(keeper.publicKey, pos.ruleNonce);
  try {
    const sig = await sendAndConfirmTransaction(conn, withBudget([ix]), [keeper], { commitment: "confirmed" });
    const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (tx?.meta?.err) throw new Error(`confirmed with error ${JSON.stringify(tx.meta.err)}`);
    const after = await nelta.fetchPosition();
    log(`EXECUTED ${key} at ${o.price.toNumber() / 1e6} USD, attempt ${n}: ${sig}; rule active after = ${after?.rule.active}`);
  } catch (e) {
    const logs = e instanceof SendTransactionError ? (e.logs ?? []) : [];
    const reason = logs.filter((l) => /Error/.test(l)).slice(-1)[0] ?? String((e as Error).message ?? e).slice(0, 160);
    if (TERMINAL.test(reason)) {
      attempts.set(key, MAX_ATTEMPTS);
      log(`GAVE UP ${key}: ${reason}`);
    } else {
      log(`retry ${key} attempt ${n}/${MAX_ATTEMPTS}: ${reason}`);
      if (n === MAX_ATTEMPTS) log(`ALERT ${key}: retry cap reached, rule left armed for the owner`);
    }
  }
}

/** A signed memo from the keeper key lets anyone (the app included) see the keeper is live using only an RPC. */
async function heartbeat(): Promise<void> {
  const ix = new TransactionInstruction({ programId: MEMO, keys: [{ pubkey: keeper.publicKey, isSigner: true, isWritable: false }], data: Buffer.from("nelta-keeper:alive") });
  await sendAndConfirmTransaction(conn, new Transaction().add(ix), [keeper], { commitment: "confirmed" })
    .catch((e) => log(`heartbeat failed: ${String((e as Error).message ?? e).slice(0, 120)}`));
}

let busy = false;
let lastSeen: Buffer | undefined;
async function tick(data: Buffer): Promise<void> {
  if (busy || lastSeen?.equals(data)) return;
  busy = true;
  lastSeen = Buffer.from(data);
  try {
    const o = parseOracle(data);
    const now = Math.floor(Date.now() / 1000);
    const due = (await positions()).filter(({ account }) => isDue(account, o, now));
    for (const { account } of due) await execute(account, o);
  } catch (e) {
    log(`tick error: ${String((e as Error).message ?? e).slice(0, 160)}`);
  } finally {
    busy = false;
  }
}

async function main() {
  const all = await positions();
  log(`keeper ${keeper.publicKey.toBase58()} watching ${all.length} position(s), ${all.filter((p) => p.account.rule.active).length} armed`);
  if (process.argv.includes("--once")) {
    const info = await conn.getAccountInfo(SOL_ORACLE);
    if (info) await tick(info.data);
    return;
  }
  void heartbeat();
  setInterval(() => void heartbeat(), HEARTBEAT_MS);
  conn.onAccountChange(SOL_ORACLE, (info) => void tick(info.data), { commitment: "processed" });
  // Websocket subscriptions can drop silently on long unattended runs; polling keeps the keeper live.
  setInterval(() => {
    void conn.getAccountInfo(SOL_ORACLE, "processed").then((info) => info && tick(info.data)).catch(() => undefined);
  }, POLL_MS);
  setInterval(() => void positions().then((ps) => log(`alive: ${ps.length} position(s), ${ps.filter((p) => p.account.rule.active).length} armed`)).catch(() => undefined), 10 * 60_000);
}

if (require.main === module) void main();
