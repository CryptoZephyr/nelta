import assert from "node:assert/strict";
import { test } from "node:test";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { describeTransaction } from "./activity";
import idl from "./nelta.json";

const owner = new PublicKey("8jUC2MYgo2c4yapZvDHchPMsa2tog8JqupiciBgJ5vdj");

function message(names: string[], program = idl.address) {
  const tx = new Transaction({ feePayer: owner, recentBlockhash: owner.toBase58() });
  for (const name of names) {
    const entry = idl.instructions.find((ix) => ix.name === name);
    assert.ok(entry);
    tx.add(new TransactionInstruction({
      programId: new PublicKey(program),
      keys: [],
      data: Buffer.from(entry.discriminator),
    }));
  }
  return tx.compileMessage();
}

test("activity identifies recovery without requiring program log labels", () => {
  assert.equal(describeTransaction(message(["set_ratio"])), "Hedge ratio changed");
});

test("activity shows combined actions once and in transaction order", () => {
  assert.equal(
    describeTransaction(message(["revoke_rule", "set_ratio", "rebalance", "rebalance"])),
    "Rule revoked + Hedge ratio changed + Hedge synced",
  );
});

test("another program cannot label a Nelta activity using the same discriminator", () => {
  assert.equal(describeTransaction(message(["deposit"], owner.toBase58())), "Account setup");
});
