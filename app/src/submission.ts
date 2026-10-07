import { SolanaMobileWalletAdapterProtocolErrorCode } from "@solana-mobile/mobile-wallet-adapter-protocol";

const UNSIGNED = new Set<number>([
  SolanaMobileWalletAdapterProtocolErrorCode.ERROR_AUTHORIZATION_FAILED,
  SolanaMobileWalletAdapterProtocolErrorCode.ERROR_INVALID_PAYLOADS,
  SolanaMobileWalletAdapterProtocolErrorCode.ERROR_NOT_SIGNED,
]);

export async function submitToWallet<T>(submit: () => Promise<T>, setSent: (sent: boolean) => void): Promise<T> {
  setSent(true);
  try {
    return await submit();
  } catch (e) {
    if (UNSIGNED.has(Number((e as { code?: unknown } | null)?.code))) setSent(false);
    throw e;
  }
}
