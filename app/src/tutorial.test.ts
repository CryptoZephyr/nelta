import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Connection, GetAccountInfoConfig, PublicKey } from "@solana/web3.js";
import { decodePosition, Nelta, Snapshot, targetShort } from "./nelta";
import {
  acceptsDevnet, changePreferences, decodePreferences, DEVNET_CHAIN, emptyPreferences,
  PreferenceStorage, TUTORIAL_KEY, TutorialInput, TutorialPreferencesStore, tutorialProgress, tutorialScope,
} from "./tutorial";

const now = 100_000;
const position = decodePosition(readFileSync(join(__dirname, "../../programs/nelta/fixtures/position.bin")));
const owner = position.owner.toBase58();

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    position: { ...position, ratioBps: 5000, rule: { ...position.rule, active: false } },
    solLamports: 0n, shortBase: 0n, targetShort: 0n, step: 100_000n,
    price: 120, oracleAgeSecs: 1, walletLamports: 500_000_000, walletDusdt: 0,
    collateralBase: 0n, ownerWsol: 0,
    venueStatus: { liquidating: false, liquidations: 0 },
    margin: { equityUsd: 100, requiredUsd: 0, liquidationPrice: null },
    ...overrides,
  };
}

function input(snap = snapshot()): TutorialInput {
  return { owner, network: DEVNET_CHAIN, snap, reading: { owner, network: DEVNET_CHAIN, at: now - 1000 }, readError: null, attempt: null, now };
}

function funded(shortBase = 0n): Snapshot {
  const held = 73_123_456n;
  return snapshot({ solLamports: held, targetShort: targetShort(held, 5000, 100_000n), shortBase, collateralBase: 100_000_000n });
}

test("new users connect, create, get collateral and deposit without confusing the balances", () => {
  const state = input(snapshot({ position: null }));
  state.owner = null;
  state.reading = null;
  assert.equal(tutorialProgress(state).next, 0);
  state.owner = owner;
  state.reading = { owner, network: DEVNET_CHAIN, at: now };
  assert.equal(tutorialProgress(state).next, 0);
  state.snap = snapshot();
  assert.equal(tutorialProgress(state).next, 1);
  state.snap = snapshot({ walletDusdt: 100, walletLamports: 1_000_000_000 });
  assert.equal(tutorialProgress(state).next, 1, "wallet tokens are not deposited collateral");
  state.snap = snapshot({ collateralBase: 100_000_000n });
  assert.equal(tutorialProgress(state).next, 2, "collateral is not a SOL deposit");
  assert.equal(tutorialProgress(state).complete, false);
});

test("funded but unhedged positions skip deposits and the already saved percentage", () => {
  const progress = tutorialProgress(input(funded()));
  assert.equal(progress.next, 4);
  assert.deepEqual(progress.steps.map((step) => step.done), [true, true, true, true, false]);
  assert.equal(progress.complete, false);
});

test("choosing a percentage alone and a zero-sized target never prove an active hedge", () => {
  const state = input(funded());
  assert.equal(tutorialProgress(state).complete, false);
  state.snap = snapshot({ solLamports: 1n, collateralBase: 100_000_000n });
  assert.equal(tutorialProgress(state).complete, false);
  assert.match(tutorialProgress(state).body, /rounds down to zero/);
  state.snap = snapshot({ ...funded(), position: { ...position, ratioBps: 0 }, targetShort: 0n });
  assert.equal(tutorialProgress(state).next, 3);
});

test("a matching existing hedge skips setup without requiring another deposit or trade", () => {
  const snap = funded();
  snap.shortBase = snap.targetShort;
  assert.equal(tutorialProgress(input(snap)).complete, true);
  snap.collateralBase = 0n;
  assert.equal(tutorialProgress(input(snap)).complete, true, "already filled positions need no tutorial funding trade");
});

test("the rounded target must match exactly, not just approximately or an outdated target", () => {
  const snap = funded(36_500_000n);
  assert.equal(tutorialProgress(input(snap)).complete, true);
  for (const shortBase of [36_500_001n, 36_499_999n, 36_400_000n, 36_600_000n])
    assert.equal(tutorialProgress(input({ ...snap, shortBase })).complete, false);
  assert.equal(tutorialProgress(input({ ...snap, targetShort: 36_400_000n, shortBase: 36_400_000n })).complete, false);
  assert.equal(tutorialProgress(input({ ...snap, step: 0n })).complete, false);
  assert.equal(tutorialProgress(input({ ...snap, venueStatus: { liquidating: true, liquidations: 1 } })).complete, false);
});

test("wallet approval, fill waiting and confirmation without a subsequent reading cannot finish setup", () => {
  const state = input(funded(36_500_000n));
  for (const phase of [
    { kind: "wallet" as const, why: "Approve" },
    { kind: "venue" as const, attempt: 1 },
    { kind: "filling" as const, attempt: 1, max: 10, set: 1, sets: 10 },
    { kind: "confirming" as const, sig: "sig" },
    { kind: "done" as const, sig: "sig" },
  ]) {
    state.attempt = { owner, at: now, fill: true, phase };
    assert.equal(tutorialProgress(state).complete, false);
  }
  state.reading!.at = now;
  assert.equal(tutorialProgress(state).complete, true, "a post-confirmation reading completes the matching hedge");
  state.snap!.shortBase = 0n;
  assert.equal(tutorialProgress(state).complete, false, "confirmation must still be followed by an actual short");
});

test("failed fills and declined wallets leave the relevant step incomplete and keep their real message", () => {
  const state = input(funded());
  state.attempt = {
    owner, at: now - 2000, fill: true,
    phase: { kind: "failed", title: "Velocity couldn’t fill the order", body: "The short hasn’t opened or changed.", nothingChanged: true },
  };
  assert.equal(tutorialProgress(state).complete, false);
  assert.equal(tutorialProgress(state).next, 4);
  assert.match(tutorialProgress(state).body, /hasn’t opened or changed/);
  state.attempt.phase = { kind: "failed", title: "Wallet declined", body: "Nothing was signed or sent.", nothingChanged: true };
  assert.match(tutorialProgress(state).body, /Nothing was signed or sent/);
  assert.doesNotMatch(tutorialProgress(state).body, /Velocity/);
});

test("uncertain transactions remain incomplete even if a reading looks matched, including after closing the sheet", () => {
  const state = input(funded(36_500_000n));
  state.attempt = {
    owner, at: now - 2000, fill: true, sig: "sig",
    phase: { kind: "failed", title: "Check before retrying", body: "Unknown", nothingChanged: false },
  };
  assert.equal(tutorialProgress(state).complete, false);
  assert.match(tutorialProgress(state).body, /receipt in Activity/);
  state.attempt.phase = { kind: "done", sig: "sig" };
  assert.equal(tutorialProgress(state).complete, true, "a confirmed receipt plus the subsequent matching reading resolves uncertainty");
});

test("loading, read failures, old readings and stale or future prices cannot advance setup", () => {
  const state = input(funded(36_500_000n));
  assert.equal(tutorialProgress({ ...state, snap: null }).complete, false);
  assert.equal(tutorialProgress({ ...state, reading: null }).complete, false);
  assert.equal(tutorialProgress({ ...state, readError: "RPC unavailable" }).complete, false);
  assert.equal(tutorialProgress({ ...state, now: now + 30_000 }).complete, false);
  assert.equal(tutorialProgress({ ...state, now: now - 2000 }).complete, false);
  for (const oracleAgeSecs of [31, -6]) assert.equal(tutorialProgress(input({ ...state.snap!, oracleAgeSecs })).complete, false);
});

test("wallet and network changes reject the former wallet's reading and completion", () => {
  const state = input(funded(36_500_000n));
  const other = PublicKey.unique().toBase58();
  assert.equal(tutorialProgress({ ...state, owner: other }).complete, false);
  assert.equal(tutorialProgress({ ...state, reading: { ...state.reading!, owner: other } }).complete, false);
  assert.equal(tutorialProgress({ ...state, network: "solana:mainnet" }).complete, false);
  assert.equal(tutorialProgress({ ...state, reading: { ...state.reading!, network: "solana:mainnet" } }).complete, false);
  assert.equal(acceptsDevnet(["solana:mainnet"]), false);
  assert.equal(acceptsDevnet([DEVNET_CHAIN]), true);
  assert.equal(acceptsDevnet(undefined), true, "legacy wallets authorize the explicitly requested Devnet chain");
  assert.notEqual(tutorialScope(owner, DEVNET_CHAIN), tutorialScope(other, DEVNET_CHAIN));
  assert.notEqual(tutorialScope(owner, DEVNET_CHAIN), tutorialScope(owner, "solana:mainnet"));
});

class MemoryStorage implements PreferenceStorage {
  readonly values = new Map<string, string>();
  fail = false;
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) {
    if (this.fail) throw new Error("Disk unavailable");
    this.values.set(key, value);
  }
}

test("skip, completion and first-use dismissal survive reload; Help restart clears only this wallet's guidance", async () => {
  const storage = new MemoryStorage();
  const store = new TutorialPreferencesStore(storage);
  const scope = tutorialScope(owner, DEVNET_CHAIN);
  const other = tutorialScope("another-wallet", DEVNET_CHAIN);
  let prefs = changePreferences(await store.load(), other, "complete");
  prefs = changePreferences(prefs, scope, "complete");
  prefs = changePreferences(prefs, scope, "releaseSeen");
  prefs = changePreferences(prefs, scope, "ruleSeen");
  prefs = changePreferences(prefs, scope, "skip");
  await store.save(prefs);
  assert.deepEqual(await new TutorialPreferencesStore(storage).load(), prefs);
  prefs = changePreferences(prefs, scope, "restart");
  await store.save(prefs);
  const reloaded = await store.load();
  assert.equal(reloaded.skipped, false);
  assert.deepEqual(reloaded.scopes[scope], { complete: false, releaseSeen: false, ruleSeen: false });
  assert.equal(reloaded.scopes[other].complete, true);
  assert.equal(reloaded.scopes[tutorialScope("new-wallet", DEVNET_CHAIN)], undefined);
  assert.equal(tutorialProgress(input(funded())).next, 4, "restart still derives progress from existing deposits");
});

test("preference writes stay ordered; a failed save surfaces its error and doesn't break retry", async () => {
  const storage = new MemoryStorage();
  const store = new TutorialPreferencesStore(storage);
  const scope = tutorialScope(owner, DEVNET_CHAIN);
  const skipped = changePreferences(emptyPreferences(), scope, "skip");
  const restarted = changePreferences(skipped, scope, "restart");
  await Promise.all([store.save(skipped), store.save(restarted)]);
  assert.deepEqual(await store.load(), restarted);
  storage.fail = true;
  await assert.rejects(store.save(skipped), /Disk unavailable/);
  storage.fail = false;
  await store.save(skipped);
  assert.equal((await store.load()).skipped, true);
  assert.ok(storage.values.has(TUTORIAL_KEY));
  assert.deepEqual(decodePreferences("invalid JSON"), emptyPreferences());
  assert.deepEqual(decodePreferences('{"skipped":true,"scopes":[]}'), emptyPreferences());
});

test("post-transaction position reads use confirmed commitment and the receipt slot for every account and balance", async () => {
  const configs: (GetAccountInfoConfig | undefined)[] = [];
  const connection = new Connection("https://api.devnet.solana.com");
  connection.getAccountInfo = async (_address, config) => {
    assert.notEqual(typeof config, "string");
    configs.push(typeof config === "string" ? undefined : config);
    return null;
  };
  connection.getBalance = async (_address, config) => {
    assert.notEqual(typeof config, "string");
    configs.push(typeof config === "string" ? undefined : config);
    return 0;
  };
  await new Nelta(connection, position.owner).snapshot(4242);
  assert.equal(configs.length, 9);
  for (const config of configs) {
    assert.equal(config?.commitment, "confirmed");
    assert.equal(config?.minContextSlot, 4242);
  }
});
