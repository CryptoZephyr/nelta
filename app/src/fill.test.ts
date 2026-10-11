import assert from "node:assert/strict";
import { test } from "node:test";
import { Connection, Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { explain, NoFill, sendWhenFillable } from "./fill";

function signedTransaction(): Transaction {
  const owner = Keypair.generate();
  const tx = new Transaction({ feePayer: owner.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() });
  tx.add(SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
  tx.sign(owner);
  return tx;
}

test("a missing blockhash after wallet approval discards the unsent try", async () => {
  const c = new Connection("https://api.devnet.solana.com");
  c.getBlockHeight = async () => 50;
  c.simulateTransaction = async () => ({ context: { slot: 1 }, value: { err: "BlockhashNotFound", logs: [] } });
  c.sendRawTransaction = async () => { assert.fail("an invalid try must not be submitted"); };
  const sig = await sendWhenFillable(c, signedTransaction(), 100, async () => {}, () => assert.fail("nothing was broadcast"));
  assert.equal(sig, null);
});

test("RPC failure while waiting cannot turn into a fillability retry", async () => {
  const c = new Connection("https://api.devnet.solana.com");
  c.getBlockHeight = async () => 50;
  c.simulateTransaction = async () => { throw new Error("fetch failed"); };
  await assert.rejects(sendWhenFillable(c, signedTransaction(), 100, async () => {}, () => assert.fail("nothing was broadcast")), /fetch failed/);
});

test("submission is marked uncertain before a lost send response", async () => {
  const c = new Connection("https://api.devnet.solana.com");
  c.getBlockHeight = async () => 50;
  c.simulateTransaction = async () => ({ context: { slot: 1 }, value: { err: null, logs: [] } });
  let broadcast = false;
  c.sendRawTransaction = async () => {
    assert.equal(broadcast, true);
    throw new Error("network response lost");
  };
  await assert.rejects(sendWhenFillable(c, signedTransaction(), 100, async () => {}, () => { broadcast = true; }), /response lost/);
});

test("a later unsent network failure retains earlier settled broadcast and fee evidence", () => {
  const first = explain(new Error("fetch failed"), false);
  assert.match(first.body, /Nothing was sent/);
  const later = explain(new Error("fetch failed"), false, true);
  assert.match(later.body, /last try wasn’t sent/);
  assert.match(later.body, /Earlier tries failed on Devnet.*network fees/);
  assert.doesNotMatch(later.body, /Nothing was sent|Nothing was signed or sent/);
  assert.equal(later.nothingChanged, true, "earlier tries are settled failures, so this action can safely retry");
  const prepare = explain(new Error("could not build transaction"), false, true);
  assert.match(prepare.body, /Earlier tries failed on Devnet.*network fees/);
});

test("declining or disconnecting a later approval cannot erase earlier failed sends", () => {
  for (const error of [new Error("user rejected"), { code: "ERROR_SESSION_CLOSED" }, { code: -1 }, { code: -3 }]) {
    const failure = explain(error, false, true);
    assert.match(failure.body, /Earlier tries failed on Devnet.*network fees/);
    assert.doesNotMatch(failure.body, /Nothing was signed or sent/);
    assert.equal(failure.nothingChanged, true);
  }
});

test("an uncertain current send still requires its receipt regardless of earlier settled tries", () => {
  for (const prior of [false, true]) {
    const failure = explain(new Error("network response lost"), true, prior);
    assert.equal(failure.nothingChanged, false);
    assert.match(failure.body, /may still land.*Check Activity/);
    assert.doesNotMatch(failure.body, /wasn’t sent|Nothing was sent/);
  }
});

test("a no-fill result keeps custody unchanged and warns about fees without claiming a hedge", () => {
  const failure = explain(new NoFill("no full fill"), false, true);
  assert.equal(failure.nothingChanged, true);
  assert.match(failure.body, /hedge stayed as they were/);
  assert.match(failure.body, /network fees/);
});
