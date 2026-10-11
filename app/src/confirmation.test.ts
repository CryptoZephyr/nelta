import assert from "node:assert/strict";
import { test } from "node:test";
import { Connection, SignatureStatus } from "@solana/web3.js";
import { resolveReceipt, resolveReceiptFlow, settle } from "./confirmation";
import type { Plan } from "./store";
import type { TutorialAttempt } from "./tutorial";

function rpc(status: SignatureStatus | null, height = 101): Connection {
  const c = new Connection("https://api.devnet.solana.com");
  c.getSignatureStatuses = async () => ({ context: { slot: 1 }, value: [status] });
  c.getBlockHeight = async () => height;
  return c;
}

test("a status RPC failure cannot authorize another fill attempt", async () => {
  const c = rpc(null);
  c.getSignatureStatuses = async () => { throw new Error("fetch failed"); };
  await assert.rejects(settle(c, "sig", 100), /couldn’t check/);
});

test("a failed history lookup cannot be mistaken for blockhash expiry", async () => {
  const c = rpc(null);
  c.getSignatureStatuses = async (_sigs, options) => {
    if (options?.searchTransactionHistory) throw new Error("fetch failed");
    return { context: { slot: 1 }, value: [null] };
  };
  await assert.rejects(settle(c, "sig", 100), /couldn’t check/);
});

test("an unseen transaction expires only after a successful history lookup", async () => {
  assert.equal(await settle(rpc(null), "sig", 100), "expired");
});

test("confirmed and failed onchain results are preserved even if the height read fails", async () => {
  const c = rpc({ slot: 1, confirmations: 1, err: null, confirmationStatus: "confirmed" });
  c.getBlockHeight = async () => { throw new Error("fetch failed"); };
  assert.equal(await settle(c, "sig", 100), null);
  c.getSignatureStatuses = async () => ({ context: { slot: 1 }, value: [{ slot: 1, confirmations: 1, err: { InstructionError: [0, { Custom: 6289 }] } }] });
  assert.equal(await settle(c, "sig", 100), '{"InstructionError":[0,{"Custom":6289}]}');
});

test("an already processed transaction cannot be labeled expired while it awaits confirmation", async (t) => {
  let now = 0;
  t.mock.method(Date, "now", () => { const value = now; now += 61_000; return value; });
  const c = rpc({ slot: 1, confirmations: 0, err: null, confirmationStatus: "processed" });
  await assert.rejects(settle(c, "sig", 100), /still unknown/);
});

test("confirmation has a wall-clock limit even when block height keeps responding", async (t) => {
  let now = 0;
  t.mock.method(Date, "now", () => { const value = now; now += 61_000; return value; });
  await assert.rejects(settle(rpc(null, 99), "sig", 100), /still unknown/);
});

test("a transient status failure is retried before showing an unknown outcome", async () => {
  const c = rpc(null);
  let calls = 0;
  c.getSignatureStatuses = async () => {
    if (++calls === 1) throw new Error("fetch failed");
    return { context: { slot: 1 }, value: [{ slot: 1, confirmations: 1, err: null, confirmationStatus: "confirmed" }] };
  };
  assert.equal(await settle(c, "sig", 100), null);
  assert.equal(calls, 2);
});

test("confirmation does not wait for a height RPC after a definitive status", async () => {
  const c = rpc({ slot: 1, confirmations: 1, err: null, confirmationStatus: "confirmed" });
  c.getBlockHeight = async () => { assert.fail("height is unnecessary after confirmation"); };
  assert.equal(await settle(c, "sig", 100), null);
});

test("a status RPC that never responds is bounded", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 0;
  t.mock.method(Date, "now", () => now);
  const c = rpc(null);
  c.getSignatureStatuses = async () => new Promise(() => {});
  const result = settle(c, "sig", 100);
  const rejected = assert.rejects(result, /couldn’t check/);
  now = 60_001;
  t.mock.timers.tick(60_001);
  await rejected;
});

test("settlement retains the successful receipt slot without requiring another status lookup", async () => {
  const c = rpc({ slot: 4242, confirmations: 1, err: null, confirmationStatus: "confirmed" });
  let slot: number | undefined;
  assert.equal(await settle(c, "sig", 100, (value) => { slot = value; }), null);
  assert.equal(slot, 4242);
  c.getSignatureStatuses = async () => { assert.fail("completed attempts must not query the old receipt"); };
  const recent: TutorialAttempt = { owner: "owner", phase: { kind: "done", sig: "sig" }, sig: "sig", at: 1, fill: true, hedgeSetup: true, slot };
  assert.equal(await resolveReceipt(c, recent, 2), recent);
  assert.equal(recent.slot, 4242);
});

test("uncertain receipt lookup failures and missing statuses preserve uncertainty without throwing", async () => {
  const recent: TutorialAttempt = {
    owner: "owner", sig: "sig", at: 1, fill: true, hedgeSetup: true,
    phase: { kind: "failed", title: "Check before retrying", body: "It may still land.", nothingChanged: false },
  };
  const c = rpc(null);
  assert.equal(await resolveReceipt(c, recent, 2), recent);
  c.getSignatureStatuses = async () => { throw new Error("fetch failed"); };
  assert.equal(await resolveReceipt(c, recent, 2), recent);
  c.getSignatureStatuses = async () => ({ context: { slot: 1 }, value: [{ slot: 1, confirmations: 0, err: null, confirmationStatus: "processed" }] });
  assert.equal(await resolveReceipt(c, recent, 2), recent);
});

test("confirmed uncertain receipts resolve once and retain the slot for the following account read", async () => {
  const recent: TutorialAttempt = {
    owner: "owner", sig: "sig", at: 1, fill: true, hedgeSetup: true,
    phase: { kind: "failed", title: "Check before retrying", body: "It may still land.", nothingChanged: false },
  };
  const c = rpc({ slot: 4242, confirmations: 1, err: null, confirmationStatus: "confirmed" });
  const done = await resolveReceipt(c, recent, 2);
  assert.deepEqual(done.phase, { kind: "done", sig: "sig" });
  assert.equal(done.slot, 4242);
  assert.equal(done.at, 2);
  const failed = await resolveReceipt(rpc({ slot: 4243, confirmations: 1, err: { InstructionError: [0, { Custom: 6289 }] }, confirmationStatus: "confirmed" }), recent, 3);
  assert.equal(failed.phase.kind, "failed");
  assert.equal(failed.phase.kind === "failed" && failed.phase.nothingChanged, true);
  assert.equal(failed.slot, 4243);
  c.getSignatureStatuses = async () => { assert.fail("resolved receipts must not be queried again"); };
  assert.equal(await resolveReceipt(c, done, 4), done);
  assert.equal(await resolveReceipt(c, failed, 4), failed);
});

test("receipt recovery updates the matching sheet but never reopens a closed sheet or replaces a new action", async () => {
  const previous: TutorialAttempt = {
    owner: "owner", sig: "sig", at: 1, fill: true, hedgeSetup: true,
    phase: { kind: "failed", title: "Check before retrying", body: "It may still land.", nothingChanged: false },
  };
  const plan: Plan = { title: "Sync hedge", summary: "Sync", changes: [], ixs: async () => [] };
  const flow = { plan, phase: previous.phase };
  const resolved = await resolveReceipt(rpc({ slot: 42, confirmations: 1, err: null, confirmationStatus: "confirmed" }), previous, 2);
  assert.deepEqual(resolveReceiptFlow(flow, previous, resolved)?.phase, { kind: "done", sig: "sig" });
  const failed = await resolveReceipt(rpc({ slot: 42, confirmations: 1, err: { InstructionError: [0, { Custom: 6289 }] }, confirmationStatus: "confirmed" }), previous, 2);
  assert.equal(resolveReceiptFlow(flow, previous, failed)?.phase.kind, "failed");
  assert.equal(resolveReceiptFlow(flow, previous, failed)?.phase, failed.phase);
  assert.equal(resolveReceiptFlow(null, previous, resolved), null);
  const newer = { plan, phase: { kind: "preview" as const } };
  assert.equal(resolveReceiptFlow(newer, previous, resolved), newer);
  assert.equal(resolveReceiptFlow(flow, previous, { ...resolved, owner: "another-wallet" }), flow);
  assert.equal(resolveReceiptFlow(flow, previous, { ...resolved, sig: "different-signature" }), flow);
});
