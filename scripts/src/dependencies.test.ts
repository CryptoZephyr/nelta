import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";

const requireDependency = createRequire(resolve("package.json"));

test("Solana integer layouts round-trip fixed-width balances without mutating input", () => {
  const layouts = requireDependency("@solana/buffer-layout-utils") as typeof import("@solana/buffer-layout-utils");
  for (const layout of [layouts.u64(), layouts.u128(), layouts.u192(), layouts.u256(), layouts.u64be(), layouts.u128be(), layouts.u192be(), layouts.u256be()]) {
    for (const value of [0n, 1n, (1n << BigInt(layout.span * 8)) - 1n]) {
      const buffer = Buffer.alloc(layout.span);
      assert.equal(layout.encode(value, buffer, 0), layout.span);
      const before = Buffer.from(buffer);
      assert.equal(layout.decode(buffer), value);
      assert.deepEqual(buffer, before);
    }
  }
});

test("Solana RPC requests and responses work with the overridden JSON-RPC client", async () => {
  const { Connection, PublicKey } = requireDependency("@solana/web3.js") as typeof import("@solana/web3.js");
  const methods: string[] = [];
  const connection = new Connection("https://rpc.invalid", {
    fetch: async (_url, init) => {
      assert.equal(typeof init?.body, "string");
      const request = JSON.parse(String(init?.body)) as { id: string; method: string };
      assert.match(request.id, /^[\da-f-]{36}$/i);
      methods.push(request.method);
      const result = request.method === "getBalance"
        ? { context: { slot: 123 }, value: 100_000_000 }
        : 456;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
    },
  });
  assert.equal(await connection.getBalance(PublicKey.default), 100_000_000);
  assert.equal(await connection.getBlockHeight(), 456);
  assert.deepEqual(methods, ["getBalance", "getBlockHeight"]);
});

test("Anchor configuration remains readable by the patched TOML parser", () => {
  const toml = requireDependency("toml") as {
    parse: (source: string) => { programs: { devnet: { nelta: string } } };
  };
  const { PublicKey } = requireDependency("@solana/web3.js") as typeof import("@solana/web3.js");
  const config = toml.parse(readFileSync(resolve("../Anchor.toml"), "utf8"));
  assert.equal(new PublicKey(config.programs.devnet.nelta).toBase58(), config.programs.devnet.nelta);
});

test("UUID callbacks retain the CommonJS v4 API", () => {
  const uuid = requireDependency("uuid") as { v4: () => string; validate: (value: string) => boolean };
  const first = uuid.v4();
  assert.equal(uuid.validate(first), true);
  assert.notEqual(uuid.v4(), first);
});
