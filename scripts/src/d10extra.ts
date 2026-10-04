/** More D10 checks: expired rules, swapped oracle/market, replayed nonce, non-owner ratio/rebalance. Leaves the rule revoked. */
import { BN } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, TransactionInstruction } from "@solana/web3.js";
import { loadKeypair } from "@velocity-exchange/sdk";
import { NeltaClient, SOL_ORACLE, SOL_PERP_MARKET, withBudget } from "./client";
const conn = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const owner = loadKeypair(process.env.NELTA_OWNER_KEYPAIR ?? `${process.env.HOME}/nelta-keys/deployer.json`);
const keeper = Keypair.generate();
const nelta = new NeltaClient(conn, owner.publicKey, owner);
const swap = (ix: TransactionInstruction, from: PublicKey, to: PublicKey) => {
  const i = ix.keys.findIndex((k) => k.pubkey.equals(from));
  ix.keys[i] = { ...ix.keys[i], pubkey: to };
  return ix;
};
async function expectFail(label: string, ixs: TransactionInstruction[], code: string, signer: Keypair) {
  const tx = withBudget(ixs, 1_000_000 - Math.floor(Math.random() * 10_000));
  tx.feePayer = owner.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.partialSign(owner);
  if (!signer.publicKey.equals(owner.publicKey)) tx.partialSign(signer);
  const sim = await conn.simulateTransaction(tx);
  const logs = (sim.value.logs ?? []).join("\n");
  const ok = !!sim.value.err && logs.includes(code);
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: expected ${code}; got ${JSON.stringify(sim.value.err)} ${(sim.value.logs ?? []).filter((l) => /Error Code/.test(l)).pop() ?? ""}`);
  if (!ok) process.exitCode = 1;
}
(async () => {
  const send = (ixs: TransactionInstruction[]) => sendAndConfirmTransaction(conn, withBudget(ixs), [owner], { commitment: "confirmed" });
  const nonce0 = (await nelta.fetchPosition())!.ruleNonce;
  await expectFail("arm a rule that is already expired", [await nelta.setRuleIx(new BN(1), true, new BN(40_000_000), Math.floor(Date.now() / 1000) - 5)], "RuleExpired", owner);
  console.log("arm triggered rule expiring in 15s:", await send([await nelta.setRuleIx(new BN(1), true, new BN(40_000_000), Math.floor(Date.now() / 1000) + 15)]));
  const nonce = (await nelta.fetchPosition())!.ruleNonce;
  await expectFail("keeper swaps in a fake oracle", [swap(await nelta.executeRuleIx(keeper.publicKey, nonce), SOL_ORACLE, Keypair.generate().publicKey)], "ConstraintAddress", keeper);
  await expectFail("keeper swaps in a different perp market", [swap(await nelta.executeRuleIx(keeper.publicKey, nonce), SOL_PERP_MARKET, Keypair.generate().publicKey)], "ConstraintAddress", keeper);
  await expectFail("keeper replays the previous rule nonce", [await nelta.executeRuleIx(keeper.publicKey, nonce0)], "StaleNonce", keeper);
  await expectFail("non-owner opens extra short (rebalance)", [swap(await nelta.rebalanceIx(), owner.publicKey, keeper.publicKey)], "Error", keeper);
  await expectFail("non-owner changes the hedge ratio", [swap(await nelta.setRatioIx(10_000), owner.publicKey, keeper.publicKey)], "Error", keeper);
  await new Promise((r) => setTimeout(r, 25_000));
  await expectFail("keeper executes after expiry", [await nelta.executeRuleIx(keeper.publicKey, nonce)], "RuleExpired", keeper);
  console.log("revoke:", await send([await nelta.revokeRuleIx()]));
  const p = (await nelta.fetchPosition())!;
  console.log("rule active after:", p.rule.active, "nonce", p.ruleNonce.toString());
  process.exit();
})();
