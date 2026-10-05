import { SolanaMobileWalletAdapterProtocolErrorCode, SolanaSignTransactions } from "@solana-mobile/mobile-wallet-adapter-protocol";
import { transact, Web3MobileWallet } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { PublicKey, Transaction } from "@solana/web3.js";

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

export async function connect(): Promise<PublicKey> {
  return await transact(authorize);
}

export function disconnect(): void {
  authToken = undefined;
}

/** One wallet approval; the wallet signs and submits. */
export async function signAndSend(build: (owner: PublicKey) => Promise<Transaction>, options: { skipPreflight?: boolean } = {}): Promise<string> {
  return await transact(async (wallet) => {
    const owner = await authorize(wallet);
    const [sig] = await wallet.signAndSendTransactions({ ...options, transactions: [await build(owner)] });
    return sig;
  });
}

/**
 * For fills: asks the wallet to sign only, so Nelta can send the moment Velocity can fill. Wallets without
 * sign-only fall back to sign-and-send.
 */
export async function signForFill(build: (owner: PublicKey) => Promise<Transaction>): Promise<{ signed: Transaction } | { sig: string }> {
  return await transact(async (wallet) => {
    const owner = await authorize(wallet);
    const caps = await wallet.getCapabilities().catch(() => null);
    const tx = await build(owner);
    if (caps?.features?.includes(SolanaSignTransactions)) {
      const [signed] = await wallet.signTransactions({ transactions: [tx] });
      return { signed };
    }
    const [sig] = await wallet.signAndSendTransactions({ skipPreflight: true, transactions: [tx] });
    return { sig };
  });
}
