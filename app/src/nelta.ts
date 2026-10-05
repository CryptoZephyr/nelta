import { BN, Program, Provider } from "@anchor-lang/core";
import * as spl from "@solana/spl-token";
import {
  AccountMeta,
  ComputeBudgetProgram,
  Connection,
  NONCE_ACCOUNT_LENGTH,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import idl from "./nelta.json";

export const RPC = "https://api.devnet.solana.com";
export const VELOCITY = new PublicKey("vELoC1audYbSYVRXn1vPaV8Axoa9oU6BYmNGZZBDZ1P");
export const STATE = new PublicKey("2etx5NvPNxeMZ7EfHE6GjJfW2imRYEUANehNS1WB4CVW");
export const VELOCITY_SIGNER = new PublicKey("FchXiT9JgMDis6CFLjz9uG5mQYkmDtHqiWtBPEYUabaK");
export const QUOTE_ORACLE = new PublicKey("Dai8hT1YRBBm5rBSJUSKcdR11psM55LVAkshbypfC4k4");
export const SOL_ORACLE = new PublicKey("2k3UHX6ehRFzx5fTVvbL6FwXhMjkucjJDL9MuVKLo8TV");
export const QUOTE_SPOT_MARKET = new PublicKey("2QpHj5vzgCdWaGM2KSoGtYJWeSkx24cMyzUDHDrucvRc");
export const SOL_SPOT_MARKET = new PublicKey("5MzQRp6hhesVuM3CSAzBfPSNP1WaJyF1ifwkmzcrWLtU");
export const SOL_PERP_MARKET = new PublicKey("FDejXbUrSy6zayBCL5xuk2SXLHZgr8ppfFTLcHbyJorY");
export const DUSDT_MINT = new PublicKey("GqmEqYsy8EyvofDpmtFxK8zhYrgWgNokAtYoduQdL7v6");
export const WSOL_MINT = spl.NATIVE_MINT;
export const LAMPORTS = 1_000_000_000;
export const PRICE_PRECISION = 1_000_000;
const NONCE_SEED = "nelta-nonce";
const BPS = 10_000;
const MAX_ORACLE_AGE_SECS = 30;
export const MAX_ORACLE_SKEW_SECS = 5;

// Velocity account layouts, mirrored from programs/nelta/src/velocity.rs.
// Both sides are checked against programs/nelta/fixtures/layout.json in their tests.
const USER_SPOT_POSITIONS = 8 + 32 + 32 + 32;
const SPOT_POSITION_SIZE = 40;
const SPOT_MARKET_INDEX = 32;
const SPOT_BALANCE_TYPE = 34;
const USER_PERP_POSITIONS = USER_SPOT_POSITIONS + 8 * SPOT_POSITION_SIZE;
const PERP_POSITION_SIZE = 80;
const PERP_BASE_ASSET_AMOUNT = 8;
const PERP_MARKET_INDEX = 76;
const SPOT_CUMULATIVE_DEPOSIT_INTEREST = 328;
const SPOT_CUMULATIVE_INTEREST_PRECISION = 10_000_000_000n;
const PERP_ORDER_STEP_SIZE = 544;
const ORACLE_PRICE = 8;
const ORACLE_PUBLISH_TIME = 16;
const ORACLE_EXPONENT = 32;

export const VELOCITY_LAYOUT = {
  user_spot_positions: USER_SPOT_POSITIONS,
  spot_position_size: SPOT_POSITION_SIZE,
  spot_market_index: SPOT_MARKET_INDEX,
  spot_balance_type: SPOT_BALANCE_TYPE,
  user_perp_positions: USER_PERP_POSITIONS,
  perp_position_size: PERP_POSITION_SIZE,
  perp_base_asset_amount: PERP_BASE_ASSET_AMOUNT,
  perp_market_index: PERP_MARKET_INDEX,
  spot_cumulative_deposit_interest: SPOT_CUMULATIVE_DEPOSIT_INTEREST,
  perp_order_step_size: PERP_ORDER_STEP_SIZE,
  oracle_price: ORACLE_PRICE,
  oracle_publish_time: ORACLE_PUBLISH_TIME,
  oracle_exponent: ORACLE_EXPONENT,
};

const spotVault = (marketIndex: number): PublicKey =>
  PublicKey.findProgramAddressSync([Buffer.from("spot_market_vault"), new BN(marketIndex).toArrayLike(Buffer, "le", 2)], VELOCITY)[0];

export interface Rule { active: boolean; above: boolean; triggerPrice: BN; releaseLamports: BN; expiryTs: BN }
export interface PositionAccount { owner: PublicKey; bump: number; ratioBps: number; ruleNonce: BN; rule: Rule }

export interface Snapshot {
  position: PositionAccount | null;
  solLamports: bigint;
  shortBase: bigint;
  targetShort: bigint;
  step: bigint;
  price: number;
  /** now - publishTs; negative when the feed is stamped in the future. */
  oracleAgeSecs: number;
  walletLamports: number;
  walletDusdt: number;
  collateralBase: bigint;
  ownerWsol: number;
}

export function parseOracle(data: Buffer): { price: bigint; publishTs: number } {
  const raw = data.readBigInt64LE(ORACLE_PRICE);
  const publishTs = Number(data.readBigUInt64LE(ORACLE_PUBLISH_TIME) / 1_000_000n);
  const shift = 6 + data.readInt32LE(ORACLE_EXPONENT);
  const price = shift >= 0 ? raw * 10n ** BigInt(shift) : raw / 10n ** BigInt(-shift);
  return { price, publishTs };
}

/** A venue state the program's readers reject (velocity.rs `UnexpectedBorrow` / `UnexpectedLong`). */
export class InvalidVenueState extends Error {
  override name = "InvalidVenueState";
}

/** Deposit balance of a spot market in token base units; `decimals` is the market's mint decimals. Throws on a borrow. */
export function readSpot(user: Buffer, spotMarket: Buffer, marketIndex: number, decimals: number): bigint {
  let scaled = 0n;
  for (let i = 0; i < 8; i++) {
    const o = USER_SPOT_POSITIONS + i * SPOT_POSITION_SIZE;
    const balance = user.readBigUInt64LE(o);
    if (user.readUInt16LE(o + SPOT_MARKET_INDEX) === marketIndex && balance > 0n) {
      if (user[o + SPOT_BALANCE_TYPE] !== 0) throw new InvalidVenueState(`Velocity shows a borrow on spot market ${marketIndex}, which Nelta never opens (UnexpectedBorrow)`);
      scaled = balance;
    }
  }
  const lo = spotMarket.readBigUInt64LE(SPOT_CUMULATIVE_DEPOSIT_INTEREST);
  const hi = spotMarket.readBigUInt64LE(SPOT_CUMULATIVE_DEPOSIT_INTEREST + 8);
  return (scaled * ((hi << 64n) | lo)) / SPOT_CUMULATIVE_INTEREST_PRECISION / 10n ** BigInt(9 - decimals);
}

/** Size of the SOL-PERP short in base units. Throws if the position is long. */
export function readShort(user: Buffer): bigint {
  for (let i = 0; i < 8; i++) {
    const o = USER_PERP_POSITIONS + i * PERP_POSITION_SIZE;
    const base = user.readBigInt64LE(o + PERP_BASE_ASSET_AMOUNT);
    if (user.readUInt16LE(o + PERP_MARKET_INDEX) === 0 && base !== 0n) {
      if (base > 0n) throw new InvalidVenueState("Velocity shows a long SOL-PERP position, which Nelta never opens (UnexpectedLong)");
      return -base;
    }
  }
  return 0n;
}

export const readOrderStep = (perpMarket: Buffer): bigint => perpMarket.readBigUInt64LE(PERP_ORDER_STEP_SIZE);

const POSITION_DISCRIMINATOR = Buffer.from(idl.accounts[0].discriminator);
const u64 = (d: Buffer, o: number) => new BN(d.readBigUInt64LE(o).toString());

/** Fixed Position layout; Anchor's borsh account decoder throws under Hermes. */
export function decodePosition(d: Buffer): PositionAccount {
  if (!d.slice(0, 8).equals(POSITION_DISCRIMINATOR)) throw new Error("Not a Nelta position account");
  return {
    owner: new PublicKey(d.slice(8, 40)),
    bump: d[40],
    ratioBps: d.readUInt16LE(41),
    ruleNonce: u64(d, 43),
    rule: {
      active: d[51] === 1,
      above: d[52] === 1,
      triggerPrice: u64(d, 53),
      releaseLamports: u64(d, 61),
      expiryTs: new BN(d.readBigInt64LE(69).toString()),
    },
  };
}

/** Same floor-to-step formula the program enforces. */
export function targetShort(held: bigint, ratioBps: number, step: bigint): bigint {
  return ((held * BigInt(ratioBps)) / BigInt(BPS) / step) * step;
}

function marketAccounts(writable: { quoteSpot?: boolean; solSpot?: boolean; perp?: boolean }): AccountMeta[] {
  return [
    { pubkey: QUOTE_ORACLE, isSigner: false, isWritable: false },
    { pubkey: SOL_ORACLE, isSigner: false, isWritable: false },
    { pubkey: QUOTE_SPOT_MARKET, isSigner: false, isWritable: !!writable.quoteSpot },
    { pubkey: SOL_SPOT_MARKET, isSigner: false, isWritable: !!writable.solSpot },
    { pubkey: SOL_PERP_MARKET, isSigner: false, isWritable: !!writable.perp },
  ];
}

const uiAmount = async (connection: Connection, ata: PublicKey): Promise<number> => {
  const info = await connection.getAccountInfo(ata);
  return info ? Number(spl.AccountLayout.decode(info.data).amount) : 0;
};

export class Nelta {
  readonly program: Program;
  readonly position: PublicKey;
  readonly venue: { velocityState: PublicKey; velocityUser: PublicKey; velocityUserStats: PublicKey; velocityProgram: PublicKey };

  constructor(readonly connection: Connection, readonly owner: PublicKey) {
    this.program = new Program(idl as never, { connection } as Provider);
    this.position = PublicKey.findProgramAddressSync([Buffer.from("position"), owner.toBuffer()], this.program.programId)[0];
    this.venue = {
      velocityState: STATE,
      velocityUser: PublicKey.findProgramAddressSync([Buffer.from("user"), this.position.toBuffer(), new BN(0).toArrayLike(Buffer, "le", 2)], VELOCITY)[0],
      velocityUserStats: PublicKey.findProgramAddressSync([Buffer.from("user_stats"), this.position.toBuffer()], VELOCITY)[0],
      velocityProgram: VELOCITY,
    };
  }

  vaultToken = (mint: PublicKey) => spl.getAssociatedTokenAddressSync(mint, this.position, true);
  ownerToken = (mint: PublicKey) => spl.getAssociatedTokenAddressSync(mint, this.owner);

  async snapshot(): Promise<Snapshot> {
    const [pos, user, spot, quoteSpot, perp, oracle, walletLamports, walletDusdt, ownerWsol] = await Promise.all([
      this.connection.getAccountInfo(this.position),
      this.connection.getAccountInfo(this.venue.velocityUser),
      this.connection.getAccountInfo(SOL_SPOT_MARKET),
      this.connection.getAccountInfo(QUOTE_SPOT_MARKET),
      this.connection.getAccountInfo(SOL_PERP_MARKET),
      this.connection.getAccountInfo(SOL_ORACLE),
      this.connection.getBalance(this.owner),
      uiAmount(this.connection, this.ownerToken(DUSDT_MINT)),
      uiAmount(this.connection, this.ownerToken(WSOL_MINT)),
    ]);
    const position = pos ? decodePosition(Buffer.from(pos.data)) : null;
    const solLamports = user && spot ? readSpot(user.data, spot.data, 1, 9) : 0n;
    const collateralBase = user && quoteSpot ? readSpot(user.data, quoteSpot.data, 0, 6) : 0n;
    const shortBase = user ? readShort(user.data) : 0n;
    const step = perp ? readOrderStep(perp.data) : 1n;
    const o = oracle ? parseOracle(oracle.data) : { price: 0n, publishTs: 0 };
    return {
      position,
      solLamports,
      shortBase,
      targetShort: position ? targetShort(solLamports, position.ratioBps, step) : 0n,
      step,
      price: Number(o.price) / PRICE_PRECISION,
      oracleAgeSecs: Math.floor(Date.now() / 1000) - o.publishTs,
      walletLamports,
      walletDusdt: walletDusdt / 1e6,
      collateralBase,
      ownerWsol: ownerWsol / LAMPORTS,
    };
  }

  oracleFresh = (s: Snapshot) => s.oracleAgeSecs >= -MAX_ORACLE_SKEW_SECS && s.oracleAgeSecs <= MAX_ORACLE_AGE_SECS;

  async createPositionIxs(ratioBps: number): Promise<TransactionInstruction[]> {
    const init = await this.program.methods
      .initialize(ratioBps)
      .accountsStrict({ owner: this.owner, position: this.position, ...this.venue, rent: SYSVAR_RENT_PUBKEY, systemProgram: SystemProgram.programId })
      .instruction();
    const atas = [WSOL_MINT, DUSDT_MINT].flatMap((mint) => [
      spl.createAssociatedTokenAccountIdempotentInstruction(this.owner, this.vaultToken(mint), this.position, mint),
      spl.createAssociatedTokenAccountIdempotentInstruction(this.owner, this.ownerToken(mint), this.owner, mint),
    ]);
    return [init, ...atas];
  }

  private depositIx(marketIndex: 0 | 1, amount: BN): Promise<TransactionInstruction> {
    const mint = marketIndex === 0 ? DUSDT_MINT : WSOL_MINT;
    return this.program.methods
      .deposit(marketIndex, amount)
      .accountsStrict({
        owner: this.owner,
        position: this.position,
        venue: this.venue,
        spotMarketVault: spotVault(marketIndex),
        ownerToken: this.ownerToken(mint),
        vaultToken: this.vaultToken(mint),
        tokenProgram: spl.TOKEN_PROGRAM_ID,
      })
      .remainingAccounts(marketAccounts(marketIndex === 0 ? { quoteSpot: true } : { solSpot: true }))
      .instruction();
  }

  async depositSolIxs(lamports: number): Promise<TransactionInstruction[]> {
    const ata = this.ownerToken(WSOL_MINT);
    return [
      spl.createAssociatedTokenAccountIdempotentInstruction(this.owner, ata, this.owner, WSOL_MINT),
      SystemProgram.transfer({ fromPubkey: this.owner, toPubkey: ata, lamports }),
      spl.createSyncNativeInstruction(ata),
      await this.depositIx(1, new BN(lamports)),
    ];
  }

  async depositDusdtIxs(amount: number): Promise<TransactionInstruction[]> {
    return [await this.depositIx(0, new BN(Math.floor(amount * 1e6)))];
  }

  async setRatioIxs(ratioBps: number): Promise<TransactionInstruction[]> {
    return [await this.program.methods.setRatio(ratioBps).accountsStrict({ owner: this.owner, position: this.position }).instruction()];
  }

  private hedgeAccounts() {
    return { owner: this.owner, position: this.position, venue: this.venue, solSpotMarket: SOL_SPOT_MARKET, perpMarket: SOL_PERP_MARKET };
  }

  async rebalanceIxs(): Promise<TransactionInstruction[]> {
    return [await this.program.methods.rebalance().accountsStrict(this.hedgeAccounts()).remainingAccounts(marketAccounts({ perp: true })).instruction()];
  }

  async reduceHedgeIxs(base: bigint): Promise<TransactionInstruction[]> {
    return [await this.program.methods.reduceHedge(new BN(base.toString())).accountsStrict(this.hedgeAccounts()).remainingAccounts(marketAccounts({ perp: true })).instruction()];
  }

  async releaseIxs(lamports: bigint): Promise<TransactionInstruction[]> {
    const core = {
      position: this.position,
      venue: this.venue,
      solSpotMarket: SOL_SPOT_MARKET,
      perpMarket: SOL_PERP_MARKET,
      spotMarketVault: spotVault(1),
      velocitySigner: VELOCITY_SIGNER,
      vaultToken: this.vaultToken(WSOL_MINT),
      ownerToken: this.ownerToken(WSOL_MINT),
      tokenProgram: spl.TOKEN_PROGRAM_ID,
    };
    return [
      await this.program.methods
        .release(new BN(lamports.toString()))
        .accountsStrict({ owner: this.owner, core } as never)
        .remainingAccounts(marketAccounts({ solSpot: true, perp: true }))
        .instruction(),
    ];
  }

  async withdrawCollateralIxs(amount: BN): Promise<TransactionInstruction[]> {
    return [
      await this.program.methods
        .withdrawCollateral(amount)
        .accountsStrict({
          owner: this.owner,
          position: this.position,
          venue: this.venue,
          spotMarketVault: spotVault(0),
          velocitySigner: VELOCITY_SIGNER,
          vaultToken: this.vaultToken(DUSDT_MINT),
          ownerToken: this.ownerToken(DUSDT_MINT),
          tokenProgram: spl.TOKEN_PROGRAM_ID,
        })
        .remainingAccounts(marketAccounts({ quoteSpot: true }))
        .instruction(),
    ];
  }

  async setRuleIxs(triggerUsd: number, above: boolean, releaseSol: number, expiryTs: number): Promise<TransactionInstruction[]> {
    return [
      await this.program.methods
        .setRule(new BN(Math.round(triggerUsd * PRICE_PRECISION)), above, new BN(Math.round(releaseSol * LAMPORTS)), new BN(expiryTs))
        .accountsStrict({ owner: this.owner, position: this.position })
        .instruction(),
    ];
  }

  async revokeRuleIxs(): Promise<TransactionInstruction[]> {
    return [await this.program.methods.revokeRule().accountsStrict({ owner: this.owner, position: this.position }).instruction()];
  }

  /** Owner-authorised durable nonces, so signed fill attempts can be retried across oracle updates without expiring. */
  nonceAddress(i: number): Promise<PublicKey> {
    return PublicKey.createWithSeed(this.owner, `${NONCE_SEED}-${i}`, SystemProgram.programId);
  }

  async createNonceIxs(indices: number[]): Promise<TransactionInstruction[]> {
    const lamports = await this.connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH);
    const ixs: TransactionInstruction[] = [];
    for (const i of indices) {
      const noncePubkey = await this.nonceAddress(i);
      ixs.push(
        SystemProgram.createAccountWithSeed({
          fromPubkey: this.owner,
          newAccountPubkey: noncePubkey,
          basePubkey: this.owner,
          seed: `${NONCE_SEED}-${i}`,
          lamports,
          space: NONCE_ACCOUNT_LENGTH,
          programId: SystemProgram.programId,
        }),
        SystemProgram.nonceInitialize({ noncePubkey, authorizedPubkey: this.owner }),
      );
    }
    return ixs;
  }

  /**
   * Also advances every sibling nonce, so once any signed try lands successfully, every other try signed
   * against the same nonces (including ones from an earlier, interrupted session) can never land.
   */
  durableTx(ixs: TransactionInstruction[], noncePubkey: PublicKey, nonce: string, siblings: PublicKey[] = []): Transaction {
    const t = new Transaction().add(
      SystemProgram.nonceAdvance({ noncePubkey, authorizedPubkey: this.owner }),
      ...siblings.filter((s) => !s.equals(noncePubkey)).map((s) => SystemProgram.nonceAdvance({ noncePubkey: s, authorizedPubkey: this.owner })),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ...ixs,
    );
    t.feePayer = this.owner;
    t.recentBlockhash = nonce;
    return t;
  }

  /** `variant` changes the priority fee so batch-signed retries have distinct signatures. */
  tx(ixs: TransactionInstruction[], blockhash: string, variant = 0): Transaction {
    const t = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 + variant }),
      ...ixs,
    );
    t.feePayer = this.owner;
    t.recentBlockhash = blockhash;
    return t;
  }
}
