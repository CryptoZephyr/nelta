/**
 * Captures the Devnet accounts the program and app decode by raw byte offset, plus the values the
 * Velocity SDK's own IDL decoder reads from them, into programs/nelta/fixtures. The Rust and app
 * decoder tests assert they read the same values. Usage: tsx src/fixtures.ts [position]
 */
import { BN, BorshAccountsCoder } from "@anchor-lang/core";
import { Connection, PublicKey } from "@solana/web3.js";
import { getTokenAmount, SpotBalanceType, SpotMarketAccount } from "@velocity-exchange/sdk";
import velocityIdl from "@velocity-exchange/sdk/lib/node/idl/velocity.json";
import { writeFileSync } from "fs";
import { join } from "path";
import { QUOTE_SPOT_MARKET, SOL_ORACLE, SOL_PERP_MARKET, SOL_SPOT_MARKET, velocityUser } from "./client";
import neltaIdl from "./nelta.json";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
// App-owned Devnet position with both a SOL deposit and an open SOL-PERP short.
const POSITION = new PublicKey(process.argv[2] ?? "71ncsVfsPxZvVgqCDtec6EjSJ9shNnN9odsPt5eAXAbH");
const OUT = join(__dirname, "../../programs/nelta/fixtures");

type Decoded = Record<string, never>;
const velocity = new BorshAccountsCoder(velocityIdl as never);
const nelta = new BorshAccountsCoder(neltaIdl as never);
const str = (v: { toString(): string }) => v.toString();

function spotAmount(user: Decoded, market: Decoded, marketIndex: number): { scaled: string; amount: string } {
  const p = (user.spot_positions as { market_index: number; scaled_balance: BN; balance_type: Record<string, unknown> }[]).find(
    (s) => s.market_index === marketIndex && !s.scaled_balance.isZero(),
  );
  if (!p) throw new Error(`fixture user has no market ${marketIndex} deposit`);
  const m = { cumulativeDepositInterest: market.cumulative_deposit_interest, cumulativeBorrowInterest: market.cumulative_borrow_interest, decimals: market.decimals };
  // The raw IDL coder names enum variants "Deposit"/"Borrow"; the SDK math expects its camelCase variants.
  const deposit = Object.keys(p.balance_type)[0].toLowerCase() === "deposit";
  if (!deposit) throw new Error(`fixture user market ${marketIndex} balance is a borrow`);
  return { scaled: str(p.scaled_balance), amount: str(getTokenAmount(p.scaled_balance, m as never as SpotMarketAccount, SpotBalanceType.DEPOSIT)) };
}

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const user = velocityUser(POSITION);
  const keys = { position: POSITION, user, sol_spot_market: SOL_SPOT_MARKET, quote_spot_market: QUOTE_SPOT_MARKET, sol_perp_market: SOL_PERP_MARKET, sol_oracle: SOL_ORACLE };
  const { context, value } = await conn.getMultipleAccountsInfoAndContext(Object.values(keys));
  const data: Record<string, Buffer> = {};
  Object.keys(keys).forEach((name, i) => {
    if (!value[i]) throw new Error(`${name} not found`);
    data[name] = value[i]!.data;
    writeFileSync(join(OUT, `${name}.bin`), value[i]!.data);
  });

  const pos = nelta.decode("Position", data.position) as Decoded;
  const u = velocity.decode("User", data.user) as Decoded;
  const solSpot = velocity.decode("SpotMarket", data.sol_spot_market) as Decoded;
  const quoteSpot = velocity.decode("SpotMarket", data.quote_spot_market) as Decoded;
  const perp = velocity.decode("PerpMarket", data.sol_perp_market) as Decoded;
  const oracle = velocity.decode("PythLazerOracle", data.sol_oracle) as Decoded;
  const perpPos = (u.perp_positions as { market_index: number; base_asset_amount: BN }[]).find((p) => p.market_index === 0 && !p.base_asset_amount.isZero());
  if (!perpPos || !perpPos.base_asset_amount.isNeg()) throw new Error("fixture user has no SOL-PERP short");
  const exponent = oracle.exponent as number;
  const shift = 6 + exponent;
  const raw = oracle.price as BN;
  const rule = pos.rule as Decoded;

  const expected = {
    slot: context.slot,
    accounts: Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, v.toBase58()])),
    position: {
      owner: (pos.owner as PublicKey).toBase58(),
      bump: pos.bump,
      ratio_bps: pos.ratio_bps,
      rule_nonce: str(pos.rule_nonce),
      rule: { active: rule.active, above: rule.above, trigger_price: str(rule.trigger_price), release_lamports: str(rule.release_lamports), expiry_ts: str(rule.expiry_ts) },
    },
    user: {
      authority: (u.authority as PublicKey).toBase58(),
      sol: spotAmount(u, solSpot, 1),
      quote: spotAmount(u, quoteSpot, 0),
      perp_base_asset_amount: str(perpPos.base_asset_amount),
    },
    sol_spot_market: { cumulative_deposit_interest: str(solSpot.cumulative_deposit_interest), decimals: solSpot.decimals },
    quote_spot_market: { cumulative_deposit_interest: str(quoteSpot.cumulative_deposit_interest), decimals: quoteSpot.decimals },
    sol_perp_market: { order_step_size: str(perp.order_step_size) },
    sol_oracle: {
      price: str(raw),
      exponent,
      publish_time_us: str(oracle.publish_time),
      price_precision: str(shift >= 0 ? raw.mul(new BN(10).pow(new BN(shift))) : raw.div(new BN(10).pow(new BN(-shift)))),
      publish_ts: (oracle.publish_time as BN).div(new BN(1_000_000)).toNumber(),
    },
  };
  writeFileSync(join(OUT, "expected.json"), `${JSON.stringify(expected, null, 2)}\n`);
  console.log(`wrote fixtures at slot ${context.slot}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
