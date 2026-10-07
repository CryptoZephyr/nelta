import assert from "node:assert/strict";
import { test } from "node:test";
import { Connection, Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { sendWhenFillable } from "./fill";

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
