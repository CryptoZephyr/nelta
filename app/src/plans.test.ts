import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Connection } from "@solana/web3.js";
import { toLamports } from "./format";
import { decodePosition, Nelta, Snapshot } from "./nelta";
import idl from "./nelta.json";
import { closeHedge } from "./plans";

function snapshot(): Snapshot {
  const position = decodePosition(readFileSync(join(__dirname, "../../programs/nelta/fixtures/position.bin")));
  return {
    position: { ...position, ratioBps: 5000, rule: { ...position.rule, active: false } },
    solLamports: 73_123_456n, shortBase: 0n, targetShort: 36_500_000n, step: 100_000n,
    price: 120, oracleAgeSecs: 1, walletLamports: 500_000_000, walletDusdt: 0,
    collateralBase: 100_000_000n, ownerWsol: 0,
    venueStatus: { liquidating: false, liquidations: 0 },
    margin: { equityUsd: 100, requiredUsd: 0, liquidationPrice: null },
  };
}

const discriminator = (name: string) => Buffer.from(idl.instructions.find((ix) => ix.name === name)!.discriminator);

test("recovery before the first hedge avoids a zero-sized reduce order", async () => {
  const snap = snapshot();
  const n = new Nelta(new Connection("https://api.devnet.solana.com"), snap.position!.owner);
  const ixs = await closeHedge(snap).ixs(n);
  assert.equal(ixs.length, 1);
  assert.deepEqual(ixs[0].data.subarray(0, 8), discriminator("set_ratio"));
});

test("recovery revokes an active rule before closing a nonzero hedge", async () => {
  const snap = snapshot();
  snap.position!.rule.active = true;
  snap.shortBase = 36_500_000n;
  const n = new Nelta(new Connection("https://api.devnet.solana.com"), snap.position!.owner);
  const ixs = await closeHedge(snap).ixs(n);
  assert.deepEqual(ixs.map((ix) => ix.data.subarray(0, 8)), [discriminator("revoke_rule"), discriminator("set_ratio"), discriminator("reduce_hedge")]);
});

test("invalid and overflowing amounts never crash amount-input screens", () => {
  for (const value of ["", "0", "-1", "Infinity", "1e308", "NaN", "hello", "0.0000000001"]) assert.equal(toLamports(value), null);
  assert.equal(toLamports("0.073123456"), 73_123_456n);
});
