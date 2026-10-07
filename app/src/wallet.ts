import { SolanaMobileWalletAdapterProtocolErrorCode, SolanaSignTransactions } from "@solana-mobile/mobile-wallet-adapter-protocol";
import { transact, Web3MobileWallet } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { PublicKey, Transaction } from "@solana/web3.js";
import { submitToWallet } from "./submission";

const IDENTITY = { name: "Nelta", uri: "https://github.com/CryptoZephyr/nelta/", icon: "raw/main/app/assets/icon.png" };
const CHAIN = "solana:devnet";
let authToken: string | undefined;

function isAuthorizationFailure(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === SolanaMobileWalletAdapterProtocolErrorCode.ERROR_AUTHORIZATION_FAILED;
}

/** Reuses the cached token; if the wallet rejects it (expired or revoked), drops it and asks for a fresh authorization once. */
async function authorize(wallet: Web3MobileWallet): Promise<PublicKey> {
  const request = (auth_token?: string) => wallet.authorize({ chain: CHAIN, identity: IDENTITY, auth_token });
  let auth;
  try {
    auth = await request(authToken);
  } catch (e) {
    if (authToken === undefined || !isAuthorizationFailure(e)) throw e;
    authToken = undefined;
    auth = await request();
  }
  authToken = auth.auth_token;
  return new PublicKey(Buffer.from(auth.accounts[0].address, "base64"));
}

/** If the wallet refuses the cached token at signing time, nothing was signed: authorize afresh once and ask again. */
async function withFreshAuth<R>(wallet: Web3MobileWallet, sign: (owner: PublicKey) => Promise<R>): Promise<R> {
  const owner = await authorize(wallet);
  try {
    return await sign(owner);
  } catch (e) {
    if (!isAuthorizationFailure(e)) throw e;
    authToken = undefined;
    return await sign(await authorize(wallet));
  }
}

export async function connect(): Promise<PublicKey> {
  return await transact(authorize);
}

export function disconnect(): void {
  authToken = undefined;
}

/** One wallet approval; the wallet signs and submits. */
/** Phantom rejects sign-and-send requests without `minContextSlot` without showing an approve screen. */
export async function signAndSend(build: (owner: PublicKey) => Promise<Transaction>, options: { minContextSlot: number; skipPreflight?: boolean }, setSent: (sent: boolean) => void): Promise<string> {
  return await transact(async (wallet) => {
    return await withFreshAuth(wallet, async (owner) => {
      const transactions = [await build(owner)];
      const [sig] = await submitToWallet(() => wallet.signAndSendTransactions({ ...options, transactions }), setSent);
      return sig;
    });
  });
}

/**
 * For fills: asks the wallet to sign only, so Nelta can send the moment Velocity can fill. Wallets without
 * sign-only fall back to sign-and-send.
 */
export async function signForFill(build: (owner: PublicKey) => Promise<Transaction>, minContextSlot: number, setSent: (sent: boolean) => void): Promise<{ signed: Transaction } | { sig: string }> {
  return await transact(async (wallet) => {
    const caps = await wallet.getCapabilities().catch(() => null);
    return await withFreshAuth(wallet, async (owner): Promise<{ signed: Transaction } | { sig: string }> => {
      const tx = await build(owner);
      if (caps?.features?.includes(SolanaSignTransactions)) {
        const [signed] = await wallet.signTransactions({ transactions: [tx] });
        return { signed };
      }
      const [sig] = await submitToWallet(() => wallet.signAndSendTransactions({ minContextSlot, skipPreflight: true, transactions: [tx] }), setSent);
      return { sig };
    });
  });
}
