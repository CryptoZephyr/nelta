import { transact, Web3MobileWallet } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { PublicKey, Transaction } from "@solana/web3.js";

const IDENTITY = { name: "Nelta", uri: "https://github.com/CryptoZephyr/nelta", icon: "favicon.ico" };
const CHAIN = "solana:devnet";
let authToken: string | undefined;

async function authorize(wallet: Web3MobileWallet): Promise<PublicKey> {
  const auth = await wallet.authorize({ chain: CHAIN, identity: IDENTITY, auth_token: authToken });
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
export async function signAndSend(build: (owner: PublicKey) => Promise<Transaction>): Promise<string> {
  return await transact(async (wallet) => {
    const owner = await authorize(wallet);
    const [sig] = await wallet.signAndSendTransactions({ transactions: [await build(owner)] });
    return sig;
  });
}

/** One wallet approval for several signed variants, so the app can retry fill-dependent actions. */
export async function signBatch(build: (owner: PublicKey) => Promise<Transaction[]>): Promise<Transaction[]> {
  return await transact(async (wallet) => {
    const owner = await authorize(wallet);
    return wallet.signTransactions({ transactions: await build(owner) });
  });
}
