/**
 * Devnet lifecycle for the Nelta program. Usage: tsx src/e2e.ts <step>
 * Steps: init | fund | hedge | negative | rule | replay | recover | state
 * Env: NELTA_OWNER_KEYPAIR (owner + fee payer), NELTA_KEEPER_KEYPAIR (independent keeper fee payer).
 */
import { BN } from "@anchor-lang/core";
import * as spl from "@solana/spl-token";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, TransactionInstruction } from "@solana/web3.js";
import { BulkAccountLoader, convertToNumber, loadKeypair, QUOTE_PRECISION, TokenFaucet, VelocityClient, Wallet } from "@velocity-exchange/sdk";
import { DUSDT_MINT, NeltaClient, SOL_ORACLE, WSOL_MINT, withBudget } from "./client";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const FAUCET = new PublicKey("V4v1mQiAdLz4qwckEb45WqHYceYizoib39cDBHSWfaB");
const SOL = 1_000_000_000;
const DEPOSIT_LAMPORTS = 100_100_000; // 0.1001 SOL so interest rounding cannot drop the target below 0.05
const RELEASE_LAMPORTS = 40_000_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const conn = new Connection(RPC, "confirmed");
const owner = loadKeypair(process.env.NELTA_OWNER_KEYPAIR ?? `${process.env.HOME}/nelta-keys/deployer.json`);
const keeper = loadKeypair(process.env.NELTA_KEEPER_KEYPAIR ?? `${process.env.HOME}/nelta-day1/keys/owner.json`);
const nelta = new NeltaClient(conn, owner.publicKey, owner);

async function send(label: string, ixs: TransactionInstruction[], signers: Keypair[] = [owner]): Promise<string> {
  const sig = await sendAndConfirmTransaction(conn, withBudget(ixs), signers, { commitment: "confirmed" });
  const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (tx?.meta?.err) throw new Error(`${label} confirmed with error ${JSON.stringify(tx.meta.err)}`);
  console.log(`${label}: ${sig} (CU ${tx?.meta?.computeUnitsConsumed})`);
  return sig;
}

/** Expects simulation to fail with `code`; nothing is sent. */
async function expectFail(label: string, ixs: TransactionInstruction[], code: string, signers: Keypair[] = [owner]) {
  const tx = withBudget(ixs, 1_000_000 - Math.floor(Math.random() * 10_000));
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(...signers);
  const sim = await conn.simulateTransaction(tx);
  const logs = (sim.value.logs ?? []).join("\n");
  const ok = sim.value.err && logs.includes(code);
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: expected ${code}; got ${JSON.stringify(sim.value.err)} ${(sim.value.logs ?? []).filter((l) => /Error/.test(l)).slice(-1)}`);
  if (!ok) process.exitCode = 1;
}

/** Venue fills are only available right after an oracle update, so fire on each update. */
async function sendOnOracle(label: string, build: () => Promise<TransactionInstruction[]>, signers: Keypair[] = [owner], tries = 80) {
  for (let i = 1; i <= tries; i++) {
    await new Promise<void>((resolve) => {
      const id = conn.onAccountChange(SOL_ORACLE, () => { void conn.removeAccountChangeListener(id); resolve(); }, { commitment: "processed" });
    });
    try {
      return await send(`${label} (attempt ${i})`, await build(), signers);
    } catch (e) {
      const logs: string[] = (e as { logs?: string[]; transactionLogs?: string[] }).logs ?? (e as { transactionLogs?: string[] }).transactionLogs ?? [];
      console.log(`  attempt ${i} reverted: ${logs.filter((l) => /Error|failed/i.test(l)).slice(-1)[0] ?? String((e as Error)?.message ?? e).slice(0, 160)}`);
      await sleep(1500);
    }
  }
  throw new Error(`${label}: no fill after ${tries} attempts`);
}

async function venue() {
  const c = new VelocityClient({
    connection: conn, wallet: new Wallet(owner), authority: nelta.position, env: "devnet",
    accountSubscription: { type: "polling", accountLoader: new BulkAccountLoader(conn, "confirmed", 1000) },
  });
  if (!(await c.subscribe())) throw new Error("velocity subscribe failed");
  await c.addUser(0, nelta.position);
  return c;
}

async function state(c: VelocityClient, tag: string) {
  await c.fetchAccounts();
  const u = c.getUser(0, nelta.position);
  await u.fetchAccounts();
  const perp = u.getPerpPosition(0);
  const bal = async (k: PublicKey) => Number((await conn.getTokenAccountBalance(k).catch(() => ({ value: { amount: "0" } }))).value.amount);
  const pos = await nelta.fetchPosition();
  const s = {
    sol: u.getTokenAmount(1).toNumber() / SOL,
    short: perp ? -perp.baseAssetAmount.toNumber() / SOL : 0,
    dusdt: convertToNumber(u.getTokenAmount(0), QUOTE_PRECISION),
    openOrders: u.getOpenOrders().length,
    ownerWsol: (await bal(nelta.ownerToken(WSOL_MINT))) / SOL,
    ratioBps: pos?.ratioBps,
    rule: pos ? { active: pos.rule.active, nonce: pos.ruleNonce.toNumber() } : null,
  };
  console.log(`[${tag}]`, JSON.stringify(s));
  return s;
}

async function main() {
  const step = process.argv[2] ?? "state";
  console.log(`program ${nelta.program.programId.toBase58()} owner ${owner.publicKey.toBase58()} position ${nelta.position.toBase58()} velocityUser ${nelta.venue.velocityUser.toBase58()}`);

  if (step === "init") {
    if (!(await nelta.fetchPosition())) await send("initialize position (ratio 50%)", [await nelta.initializeIx(5_000)]);
    await send("create position + owner token accounts", nelta.tokenAccountIxs(owner.publicKey));
    return;
  }

  const c = await venue();
  const price = () => c.getOracleDataForPerpMarket(0).price;
  await state(c, `before ${step}`);

  if (step === "fund") {
    const faucet = new TokenFaucet(conn, new Wallet(owner), FAUCET, DUSDT_MINT) as unknown as {
      mintToUserIx(ata: PublicKey, amount: BN): Promise<TransactionInstruction>;
    };
    const amount = new BN(60).mul(QUOTE_PRECISION);
    await send("faucet 60 dUSDT to owner", [await faucet.mintToUserIx(nelta.ownerToken(DUSDT_MINT), amount)]);
    await send("deposit 60 dUSDT collateral via Nelta", [await nelta.depositIx(0, amount)]);
    await send("wrap + deposit 0.1001 SOL via Nelta", [...nelta.wrapIxs(DEPOSIT_LAMPORTS), await nelta.depositIx(1, new BN(DEPOSIT_LAMPORTS))]);
  }

  if (step === "hedge") await sendOnOracle("rebalance to 50% target (FullFill)", async () => [await nelta.rebalanceIx()]);

  if (step === "negative") {
    const stranger = keeper;
    const strangerWsol = spl.getAssociatedTokenAddressSync(WSOL_MINT, stranger.publicKey);
    await send("create stranger wSOL account", [spl.createAssociatedTokenAccountIdempotentInstruction(stranger.publicKey, strangerWsol, stranger.publicKey, WSOL_MINT)], [stranger]);
    await expectFail("release to a non-owner token account", [await nelta.releaseIx(new BN(RELEASE_LAMPORTS), owner.publicKey, strangerWsol)], "InvalidRecipient");
    await expectFail("release signed by a non-owner", [await nelta.releaseIx(new BN(RELEASE_LAMPORTS), stranger.publicKey)], "InvalidRecipient", [stranger]);
    await expectFail("ratio above 100%", [await nelta.setRatioIx(10_001)], "InvalidRatio");
    await expectFail("release more SOL than held", [await nelta.releaseIx(new BN(SOL))], "InsufficientSol");
    const pos = (await nelta.fetchPosition())!;
    await expectFail("keeper executes with no armed rule", [await nelta.executeRuleIx(stranger.publicKey, pos.ruleNonce)], "RuleInactive", [stranger]);
    const p = price();
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    await send("arm rule not yet triggered (above 2x price)", [await nelta.setRuleIx(p.muln(2), true, new BN(RELEASE_LAMPORTS), expiry)]);
    const armed = (await nelta.fetchPosition())!;
    await expectFail("keeper executes before trigger", [await nelta.executeRuleIx(stranger.publicKey, armed.ruleNonce)], "NotTriggered", [stranger]);
    await expectFail("keeper uses a stale nonce", [await nelta.executeRuleIx(stranger.publicKey, armed.ruleNonce.subn(1))], "StaleNonce", [stranger]);
    await expectFail("keeper redirects funds to itself", [await nelta.executeRuleIx(stranger.publicKey, armed.ruleNonce, strangerWsol)], "InvalidRecipient", [stranger]);
    await send("owner revokes rule", [await nelta.revokeRuleIx()]);
    await expectFail("keeper executes a revoked rule", [await nelta.executeRuleIx(stranger.publicKey, armed.ruleNonce)], "RuleInactive", [stranger]);
  }

  if (step === "rule") {
    const p = price();
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const trigger = p.muln(95).divn(100);
    console.log(`oracle ${convertToNumber(p)} USD; arming "if SOL >= ${convertToNumber(trigger)} release 0.04 SOL and shrink the hedge"`);
    await send("owner arms one-use rule", [await nelta.setRuleIx(trigger, true, new BN(RELEASE_LAMPORTS), expiry)]);
    const nonce = (await nelta.fetchPosition())!.ruleNonce;
    console.log("owner key no longer used; keeper executes alone");
    await sendOnOracle("keeper executes rule (paired reduce + release)", async () => [await nelta.executeRuleIx(keeper.publicKey, nonce)], [keeper]);
    await expectFail("keeper replays the executed rule", [await nelta.executeRuleIx(keeper.publicKey, nonce)], "RuleInactive", [keeper]);
  }

  if (step === "replay") {
    const pos = (await nelta.fetchPosition())!;
    await expectFail("keeper replays the executed rule", [await nelta.executeRuleIx(keeper.publicKey, pos.ruleNonce)], "RuleInactive", [keeper]);
  }

  if (step === "recover") {
    await send("owner sets ratio to 0", [await nelta.setRatioIx(0)]);
    const u = c.getUser(0, nelta.position);
    await u.fetchAccounts();
    const perp = u.getPerpPosition(0);
    const short = perp ? perp.baseAssetAmount.abs() : new BN(0);
    if (!short.isZero()) {
      await send(`owner places resting reduce-only order for ${short.toNumber() / SOL} SOL`, [await nelta.reduceHedgeIx(short)]);
      for (let i = 0; i < 60; i++) {
        await sleep(5000);
        await u.fetchAccounts();
        const p = u.getPerpPosition(0);
        if (!p || p.baseAssetAmount.isZero()) { console.log(`keeper closed the short after ~${(i + 1) * 5}s`); break; }
      }
    }
    await c.fetchAccounts();
    await u.fetchAccounts();
    const sol = u.getTokenAmount(1);
    if (!sol.isZero()) await send(`owner releases remaining ${sol.toNumber() / SOL} SOL`, [await nelta.releaseIx(sol)]);
    const q = u.getTokenAmount(0);
    if (!q.isZero()) await send(`owner withdraws ${convertToNumber(q, QUOTE_PRECISION)} dUSDT`, [await nelta.withdrawCollateralIx(q)]);
  }

  await sleep(2500);
  await state(c, `after ${step}`);
  await c.unsubscribe();
}

main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error("ERR", e?.message ?? e, e?.logs ?? ""); process.exit(1); });
