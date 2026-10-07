import assert from "node:assert/strict";
import { test } from "node:test";
import { Connection, SignatureStatus } from "@solana/web3.js";
import { settle } from "./confirmation";

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
