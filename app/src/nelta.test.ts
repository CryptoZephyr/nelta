import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mock, test } from "node:test";
import { Connection, PublicKey } from "@solana/web3.js";
import { decodePosition, InvalidVenueState, margin, Nelta, parseOracle, readOrderStep, readPerpQuote, readShort, readSpot, readVenueStatus, SOL_ORACLE, targetShort, VELOCITY_LAYOUT } from "./nelta";

// Same Devnet account snapshots and SDK-decoded values the Rust decoder tests use.
const FIXTURES = join(__dirname, "../../programs/nelta/fixtures");
const bin = (name: string) => readFileSync(join(FIXTURES, name));
const expected = JSON.parse(readFileSync(join(FIXTURES, "expected.json"), "utf8"));
const layout = JSON.parse(readFileSync(join(FIXTURES, "layout.json"), "utf8"));

test("Velocity offsets match the shared layout used by velocity.rs", () => {
  assert.deepEqual(VELOCITY_LAYOUT, layout.velocity);
});

test("position decoder matches the shared layout and fixture", () => {
  const p = decodePosition(bin("position.bin"));
  const e = expected.position;
  assert.equal(p.owner.toBase58(), e.owner);
  assert.equal(p.bump, e.bump);
  assert.equal(p.ratioBps, e.ratio_bps);
  assert.equal(p.ruleNonce.toString(), e.rule_nonce);
  assert.equal(p.rule.active, e.rule.active);
  assert.equal(p.rule.above, e.rule.above);
  assert.equal(p.rule.triggerPrice.toString(), e.rule.trigger_price);
  assert.equal(p.rule.releaseLamports.toString(), e.rule.release_lamports);
  assert.equal(p.rule.expiryTs.toString(), e.rule.expiry_ts);
  assert.equal(bin("position.bin").length, layout.position.size);
  assert.throws(() => decodePosition(bin("user.bin")), /Not a Nelta position/);
});

test("Velocity readers match the SDK on Devnet fixtures", () => {
  const user = bin("user.bin");
  assert.equal(readSpot(user, bin("sol_spot_market.bin"), 1, 9).toString(), expected.user.sol.amount);
  assert.equal(readSpot(user, bin("quote_spot_market.bin"), 0, 6).toString(), expected.user.quote.amount);
  assert.equal((-readShort(user)).toString(), expected.user.perp_base_asset_amount);
  assert.equal(readOrderStep(bin("sol_perp_market.bin")).toString(), expected.sol_perp_market.order_step_size);
  const o = parseOracle(bin("sol_oracle.bin"));
  assert.equal(o.price.toString(), expected.sol_oracle.price_precision);
  assert.equal(o.publishTs, expected.sol_oracle.publish_ts);
});

test("readers throw on venue states the program rejects", () => {
  const borrow = Buffer.from(bin("user.bin"));
  for (let i = 0; i < 8; i++) {
    const o = layout.velocity.user_spot_positions + i * layout.velocity.spot_position_size;
    if (borrow.readUInt16LE(o + layout.velocity.spot_market_index) === 1) borrow[o + layout.velocity.spot_balance_type] = 1;
  }
  assert.throws(() => readSpot(borrow, bin("sol_spot_market.bin"), 1, 9), InvalidVenueState);

  const long = Buffer.from(bin("user.bin"));
  const o = layout.velocity.user_perp_positions + layout.velocity.perp_base_asset_amount;
  long.writeBigInt64LE(-long.readBigInt64LE(o), o);
  assert.throws(() => readShort(long), InvalidVenueState);
});

test("targetShort floors to the order step like the program", () => {
  assert.equal(targetShort(100_000_000n, 5_000, 100_000n), 50_000_000n);
  assert.equal(targetShort(60_000_000n, 5_000, 100_000n), 30_000_000n);
  assert.equal(targetShort(123_456_789n, 5_000, 100_000n), 61_700_000n);
});

test("a cached snapshot becomes stale even when the next RPC refresh fails", async () => {
  const oracle = bin("sol_oracle.bin");
  const { publishTs } = parseOracle(oracle);
  let now = publishTs + 3;
  const clock = mock.method(Date, "now", () => now * 1000);
  try {
    const connection = new Connection("https://api.devnet.solana.com");
    connection.getAccountInfo = async (key) => key.equals(SOL_ORACLE)
      ? { data: oracle, executable: false, lamports: 1, owner: SOL_ORACLE, rentEpoch: 0 }
      : null;
    connection.getBalance = async () => 1;
    const nelta = new Nelta(connection, new PublicKey(expected.position.owner));
    const cached = await nelta.snapshot();
    assert.equal(cached.oracleAgeSecs, 3);
    assert.equal(nelta.oracleFresh(cached), true);
    connection.getAccountInfo = async () => { throw new Error("network offline"); };
    now += 28;
    await assert.rejects(nelta.snapshot(), /network offline/);
    assert.equal(cached.oracleAgeSecs, 31);
    assert.equal(nelta.oracleFresh(cached), false);
    now = publishTs - 6;
    assert.equal(nelta.oracleFresh(cached), false);
  } finally {
    clock.mock.restore();
  }
});

// Values below were read from the same fixtures with the SDK's Velocity IDL (BorshAccountsCoder).
test("margin readers match the Velocity IDL on Devnet fixtures", () => {
  const user = bin("user.bin");
  assert.equal(readPerpQuote(user), 6_079_463n);
  assert.deepEqual(readVenueStatus(user), { liquidating: false, liquidations: 0 });
  assert.equal(bin("sol_perp_market.bin").readUInt32LE(620), 500);
  assert.equal(bin("sol_spot_market.bin").readUInt32LE(660), 9_000);

  const liquidating = Buffer.from(user);
  liquidating[4468] = 1;
  liquidating.writeUInt16LE(3, 4464);
  assert.deepEqual(readVenueStatus(liquidating), { liquidating: true, liquidations: 2 });
});

test("margin: a 50% hedge backed by its own SOL can't be liquidated by price alone", () => {
  const m = margin({ collateralUsd: 50, sol: 0.1, shortSol: 0.05, quoteUsd: 6, price: 120, maintMargin: 0.05, solWeight: 0.9 });
  assert.equal(m.liquidationPrice, null);
  assert.ok(Math.abs(m.equityUsd - (50 + 10.8 + 6 - 6)) < 1e-9);
  assert.ok(Math.abs(m.requiredUsd - 0.3) < 1e-9);
});

test("margin: a 100% hedge has a liquidation price where equity meets the requirement", () => {
  const i = { collateralUsd: 10, sol: 0.1, shortSol: 0.1, quoteUsd: 12, price: 120, maintMargin: 0.05, solWeight: 0.9 };
  const p = margin(i).liquidationPrice!;
  const at = margin({ ...i, price: p });
  assert.ok(Math.abs(at.equityUsd - at.requiredUsd) < 1e-9);
  assert.ok(p > 120);
});
