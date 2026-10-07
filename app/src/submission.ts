import { SolanaMobileWalletAdapterProtocolErrorCode } from "@solana-mobile/mobile-wallet-adapter-protocol";

const UNSIGNED = new Set<number>([
  SolanaMobileWalletAdapterProtocolErrorCode.ERROR_AUTHORIZATION_FAILED,
  SolanaMobileWalletAdapterProtocolErrorCode.ERROR_INVALID_PAYLOADS,
  SolanaMobileWalletAdapterProtocolErrorCode.ERROR_NOT_SIGNED,
]);

export function walletErrorCode(e: unknown): unknown {
  const error = e as { code?: unknown; userInfo?: { jsonRpcErrorCode?: unknown } } | null;
  return error?.code === "JSON_RPC_ERROR" ? error.userInfo?.jsonRpcErrorCode : error?.code;
}

export async function submitToWallet<T>(submit: () => Promise<T>, setSent: (sent: boolean) => void): Promise<T> {
  setSent(true);
  try {
    return await submit();
  } catch (e) {
    if (UNSIGNED.has(Number(walletErrorCode(e)))) setSent(false);
    throw e;
  }
}
