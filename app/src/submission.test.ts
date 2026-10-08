import assert from "node:assert/strict";
import { test } from "node:test";
import { SolanaMobileWalletAdapterProtocolErrorCode as Code } from "@solana-mobile/mobile-wallet-adapter-protocol";
import { submitToWallet, walletErrorCode } from "./submission";

test("a wallet transport failure preserves broadcast uncertainty", async () => {
  const sent: boolean[] = [];
  await assert.rejects(submitToWallet(async () => { throw new Error("session timed out after sending"); }, (v) => sent.push(v)));
  assert.deepEqual(sent, [true]);
});

test("an explicit unsigned refusal permits a safe retry", async () => {
  for (const code of [Code.ERROR_NOT_SIGNED, Code.ERROR_AUTHORIZATION_FAILED, Code.ERROR_INVALID_PAYLOADS]) {
    const sent: boolean[] = [];
    await assert.rejects(submitToWallet(async () => { throw Object.assign(new Error("refused"), { code }); }, (v) => sent.push(v)));
    assert.deepEqual(sent, [true, false]);
  }
});

test("a successful submission stays marked as potentially broadcast", async () => {
  const sent: boolean[] = [];
  assert.equal(await submitToWallet(async () => "signature", (v) => sent.push(v)), "signature");
  assert.deepEqual(sent, [true]);
});

test("Android protocol refusals permit retry before the adapter normalizes the error", async () => {
  for (const code of [Code.ERROR_NOT_SIGNED, Code.ERROR_AUTHORIZATION_FAILED, Code.ERROR_INVALID_PAYLOADS]) {
    const error = Object.assign(new Error("refused"), {
      code: "JSON_RPC_ERROR",
      userInfo: { jsonRpcErrorCode: code },
    });
    assert.equal(walletErrorCode(error), code);
    const sent: boolean[] = [];
    await assert.rejects(submitToWallet(async () => { throw error; }, (v) => sent.push(v)));
    assert.deepEqual(sent, [true, false]);
  }
});

test("Android internal errors and missing protocol details remain uncertain", async () => {
  for (const userInfo of [{ jsonRpcErrorCode: -32603 }, {}]) {
    const error = Object.assign(new Error("unknown outcome"), { code: "JSON_RPC_ERROR", userInfo });
    const sent: boolean[] = [];
    await assert.rejects(submitToWallet(async () => { throw error; }, (v) => sent.push(v)));
    assert.deepEqual(sent, [true]);
  }
});
