import { AnchorProvider, BN, Program, Wallet } from "@anchor-lang/core";
import * as spl from "@solana/spl-token";
import {
  AccountMeta,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import idl from "./nelta.json";

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

export const spotVault = (marketIndex: number): PublicKey =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("spot_market_vault"), new BN(marketIndex).toArrayLike(Buffer, "le", 2)],
    VELOCITY,
  )[0];

export const positionPda = (owner: PublicKey, programId: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync([Buffer.from("position"), owner.toBuffer()], programId)[0];

export const velocityUser = (authority: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("user"), authority.toBuffer(), new BN(0).toArrayLike(Buffer, "le", 2)],
    VELOCITY,
  )[0];

export const velocityUserStats = (authority: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync([Buffer.from("user_stats"), authority.toBuffer()], VELOCITY)[0];

/** Accounts Velocity needs to value the position: both oracles, both spot markets, SOL-PERP. */
export function marketAccounts(writable: { quoteSpot?: boolean; solSpot?: boolean; perp?: boolean }): AccountMeta[] {
  return [
    { pubkey: QUOTE_ORACLE, isSigner: false, isWritable: false },
    { pubkey: SOL_ORACLE, isSigner: false, isWritable: false },
    { pubkey: QUOTE_SPOT_MARKET, isSigner: false, isWritable: !!writable.quoteSpot },
    { pubkey: SOL_SPOT_MARKET, isSigner: false, isWritable: !!writable.solSpot },
    { pubkey: SOL_PERP_MARKET, isSigner: false, isWritable: !!writable.perp },
  ];
}

export class NeltaClient {
  readonly program: Program;
  readonly position: PublicKey;
  readonly venue: { velocityState: PublicKey; velocityUser: PublicKey; velocityUserStats: PublicKey; velocityProgram: PublicKey };

  constructor(readonly connection: Connection, readonly owner: PublicKey, payer: Keypair) {
    const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" });
    this.program = new Program(idl as never, provider);
    this.position = positionPda(owner, this.program.programId);
    this.venue = {
      velocityState: STATE,
      velocityUser: velocityUser(this.position),
      velocityUserStats: velocityUserStats(this.position),
      velocityProgram: VELOCITY,
    };
  }

  vaultToken(mint: PublicKey): PublicKey {
    return spl.getAssociatedTokenAddressSync(mint, this.position, true);
  }

  ownerToken(mint: PublicKey): PublicKey {
    return spl.getAssociatedTokenAddressSync(mint, this.owner);
  }

  async fetchPosition() {
    return (this.program.account as never as { position: { fetchNullable(k: PublicKey): Promise<PositionAccount | null> } }).position.fetchNullable(this.position);
  }

  initializeIx(ratioBps: number): Promise<TransactionInstruction> {
    return this.program.methods
      .initialize(ratioBps)
      .accountsStrict({
        owner: this.owner,
        position: this.position,
        velocityState: STATE,
        velocityUser: this.venue.velocityUser,
        velocityUserStats: this.venue.velocityUserStats,
        velocityProgram: VELOCITY,
        rent: SYSVAR_RENT_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /** Creates the position-owned and owner-owned token accounts for wSOL and dUSDT. */
  tokenAccountIxs(payer: PublicKey): TransactionInstruction[] {
    return [WSOL_MINT, DUSDT_MINT].flatMap((mint) => [
      spl.createAssociatedTokenAccountIdempotentInstruction(payer, this.vaultToken(mint), this.position, mint),
      spl.createAssociatedTokenAccountIdempotentInstruction(payer, this.ownerToken(mint), this.owner, mint),
    ]);
  }

  depositIx(marketIndex: 0 | 1, amount: BN): Promise<TransactionInstruction> {
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

  /** Wraps native SOL into the owner's wSOL account so it can be deposited. */
  wrapIxs(lamports: number): TransactionInstruction[] {
    const ata = this.ownerToken(WSOL_MINT);
    return [
      SystemProgram.transfer({ fromPubkey: this.owner, toPubkey: ata, lamports }),
      spl.createSyncNativeInstruction(ata),
    ];
  }

  setRatioIx(ratioBps: number): Promise<TransactionInstruction> {
    return this.program.methods.setRatio(ratioBps).accountsStrict({ owner: this.owner, position: this.position }).instruction();
  }

  rebalanceIx(): Promise<TransactionInstruction> {
    return this.program.methods
      .rebalance()
      .accountsStrict({
        owner: this.owner,
        position: this.position,
        venue: this.venue,
        solSpotMarket: SOL_SPOT_MARKET,
        perpMarket: SOL_PERP_MARKET,
      })
      .remainingAccounts(marketAccounts({ perp: true }))
      .instruction();
  }

  /** Owner recovery: reduce-only order that rests for Velocity keepers if it cannot fill now. */
  reduceHedgeIx(base: BN): Promise<TransactionInstruction> {
    return this.program.methods
      .reduceHedge(base)
      .accountsStrict({
        owner: this.owner,
        position: this.position,
        venue: this.venue,
        solSpotMarket: SOL_SPOT_MARKET,
        perpMarket: SOL_PERP_MARKET,
      })
      .remainingAccounts(marketAccounts({ perp: true }))
      .instruction();
  }

  releaseCore(recipient = this.ownerToken(WSOL_MINT)) {
    return {
      position: this.position,
      venue: this.venue,
      solSpotMarket: SOL_SPOT_MARKET,
      perpMarket: SOL_PERP_MARKET,
      spotMarketVault: spotVault(1),
      velocitySigner: VELOCITY_SIGNER,
      vaultToken: this.vaultToken(WSOL_MINT),
      ownerToken: recipient,
      tokenProgram: spl.TOKEN_PROGRAM_ID,
    };
  }

  releaseIx(lamports: BN, signer = this.owner, recipient?: PublicKey): Promise<TransactionInstruction> {
    return this.program.methods
      .release(lamports)
      .accountsStrict({ owner: signer, core: this.releaseCore(recipient) } as never)
      .remainingAccounts(marketAccounts({ solSpot: true, perp: true }))
      .instruction();
  }

  setRuleIx(triggerPrice: BN, above: boolean, releaseLamports: BN, expiryTs: number): Promise<TransactionInstruction> {
    return this.program.methods
      .setRule(triggerPrice, above, releaseLamports, new BN(expiryTs))
      .accountsStrict({ owner: this.owner, position: this.position })
      .instruction();
  }

  revokeRuleIx(): Promise<TransactionInstruction> {
    return this.program.methods.revokeRule().accountsStrict({ owner: this.owner, position: this.position }).instruction();
  }

  /** Permissionless: any keeper can submit; funds can only reach the owner's wSOL account. */
  executeRuleIx(keeper: PublicKey, nonce: BN, recipient?: PublicKey): Promise<TransactionInstruction> {
    return this.program.methods
      .executeRule(nonce)
      .accountsStrict({ keeper, core: this.releaseCore(recipient), oracle: SOL_ORACLE } as never)
      .remainingAccounts(marketAccounts({ solSpot: true, perp: true }))
      .instruction();
  }

  withdrawCollateralIx(amount: BN): Promise<TransactionInstruction> {
    return this.program.methods
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
      .instruction();
  }
}

export interface PositionAccount {
  owner: PublicKey;
  bump: number;
  ratioBps: number;
  ruleNonce: BN;
  rule: { active: boolean; above: boolean; triggerPrice: BN; releaseLamports: BN; expiryTs: BN };
}

export const withBudget = (ixs: TransactionInstruction[], units = 1_000_000): Transaction =>
  new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
    ...ixs,
  );
