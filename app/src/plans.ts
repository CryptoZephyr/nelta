import { BN } from "@anchor-lang/core";
import { sol, usd } from "./format";
import { LAMPORTS, Snapshot, targetShort } from "./nelta";
import { Plan } from "./store";

const ATOMIC = "Both legs change together, or the whole transaction is undone.";
const OWNER_ONLY = "Released SOL can only go to your wallet.";

export function releaseOutcome(snap: Snapshot, ratioBps: number, lamports: bigint) {
  const after = snap.solLamports - lamports;
  return { custodyAfter: after, shortAfter: targetShort(after, ratioBps, snap.step) };
}

export const createPosition = (ratioBps: number): Plan => ({
  title: "Create your position",
  summary: `Nelta opens a vault and a Velocity account that only the Nelta program controls. It will hedge ${ratioBps / 100}% of the SOL you add.`,
  changes: [{ label: "Hedge ratio", to: `${ratioBps / 100}%` }],
  notes: ["Only your wallet can withdraw. The keeper can only run rules you arm."],
  ixs: (n) => n.createPositionIxs(ratioBps),
});

export const depositSol = (snap: Snapshot, lamports: number): Plan => {
  const ratio = snap.position?.ratioBps ?? 0;
  const after = snap.solLamports + BigInt(lamports);
  return {
    title: `Add ${sol(lamports)} SOL`,
    summary: "Moves SOL from your wallet into custody.",
    changes: [
      { label: "Wallet", from: `${sol(snap.walletLamports, 3)} SOL`, to: `${sol(snap.walletLamports - lamports, 3)} SOL` },
      { label: "SOL in custody", from: `${sol(snap.solLamports)} SOL`, to: `${sol(after)} SOL` },
      { label: "Target short", from: `${sol(snap.targetShort)} SOL`, to: `${sol(targetShort(after, ratio, snap.step))} SOL` },
    ],
    notes: ["Your hedge will be out of sync until you tap Sync hedge."],
    ixs: (n) => n.depositSolIxs(lamports),
  };
};

export const depositDusdt = (snap: Snapshot): Plan => ({
  title: `Add ${snap.walletDusdt.toFixed(2)} dUSDT collateral`,
  summary: "Collateral backs the short on Velocity.",
  changes: [{ label: "Collateral", from: `${(Number(snap.collateralBase) / 1e6).toFixed(2)} dUSDT`, to: `${(Number(snap.collateralBase) / 1e6 + snap.walletDusdt).toFixed(2)} dUSDT` }],
  ixs: (n) => n.depositDusdtIxs(snap.walletDusdt),
});

export const TEST_DUSDT = 100;

export const faucetCollateral = (snap: Snapshot): Plan => {
  const now = Number(snap.collateralBase) / 1e6;
  return {
    title: `Get ${TEST_DUSDT} test dUSDT as collateral`,
    summary: "Mints free Devnet dUSDT from Velocity’s test faucet and adds it as collateral for the short, in one transaction. Devnet only; it has no real value.",
    changes: [
      { label: "Collateral", from: `${now.toFixed(2)} dUSDT`, to: `${(now + TEST_DUSDT).toFixed(2)} dUSDT` },
      { label: "Your SOL", to: "Unchanged (only the network fee)" },
    ],
    notes: ["SOL deposits don’t create dUSDT. This is the step that does."],
    ixs: (n) => n.faucetDusdtIxs(TEST_DUSDT, true),
  };
};

export const syncHedge = (snap: Snapshot): Plan => ({
  title: "Sync hedge",
  summary: "Moves the SOL-PERP short to its target so it matches the SOL Nelta holds.",
  changes: [{ label: "SOL-PERP short", from: `${sol(snap.shortBase)} SOL`, to: `${sol(snap.targetShort)} SOL` }],
  notes: ["Velocity has to fill the whole order at once. If it can’t, nothing changes and Nelta tries again on the next price update."],
  fill: true,
  ixs: (n) => n.rebalanceIxs(),
});

export const changeRatio = (snap: Snapshot, ratioBps: number): Plan => {
  const to = targetShort(snap.solLamports, ratioBps, snap.step);
  return {
    title: `Hedge ${ratioBps / 100}% of your SOL`,
    summary: "Changes the hedge ratio and moves the short to match, in one transaction.",
    changes: [
      { label: "Hedge ratio", from: `${(snap.position?.ratioBps ?? 0) / 100}%`, to: `${ratioBps / 100}%` },
      { label: "SOL-PERP short", from: `${sol(snap.shortBase)} SOL`, to: `${sol(to)} SOL` },
    ],
    notes: [ATOMIC],
    fill: to !== snap.shortBase,
    ixs: async (n) => [...(await n.setRatioIxs(ratioBps)), ...(await n.rebalanceIxs())],
  };
};

export const release = (snap: Snapshot, lamports: bigint): Plan => {
  const o = releaseOutcome(snap, snap.position!.ratioBps, lamports);
  return {
    title: `Release ${sol(lamports)} SOL`,
    summary: "Shrinks the short and releases SOL in one transaction.",
    changes: [
      { label: "SOL in custody", from: `${sol(snap.solLamports)} SOL`, to: `${sol(o.custodyAfter)} SOL` },
      { label: "SOL-PERP short", from: `${sol(snap.shortBase)} SOL`, to: `${sol(o.shortAfter)} SOL` },
      { label: "You receive", to: `${sol(lamports)} SOL` },
    ],
    notes: [ATOMIC, OWNER_ONLY],
    fill: true,
    ixs: (n) => n.releaseIxs(lamports),
  };
};

export const exitKeepSol = (snap: Snapshot): Plan => ({
  ...changeRatio(snap, 0),
  title: "Keep my SOL, close the hedge",
  summary: "Sets the hedge to 0% and closes the short in one transaction. Your SOL stays in Nelta, unhedged, and you can withdraw it any time.",
});

export const exitReleaseAll = (snap: Snapshot): Plan => ({
  ...release(snap, snap.solLamports),
  title: "Release all, close the hedge",
  summary: "Closes the short and sends all SOL in custody to your wallet, in one transaction. Your dUSDT collateral stays on Velocity until you withdraw it.",
});

export const armRule = (snap: Snapshot, triggerUsd: number, above: boolean, releaseSol: number, hours: number): Plan => {
  const lamports = BigInt(Math.round(releaseSol * LAMPORTS));
  const o = releaseOutcome(snap, snap.position!.ratioBps, lamports);
  const expiry = Math.floor(Date.now() / 1000 + hours * 3600);
  return {
    title: "Arm one-use rule",
    summary: `If SOL ${above ? "rises to" : "falls to"} ${usd(triggerUsd)}, release ${releaseSol} SOL and shrink my short to match. Expires in ${hours} h.`,
    changes: [
      { label: "When it runs: custody", from: `${sol(snap.solLamports)} SOL`, to: `${sol(o.custodyAfter)} SOL` },
      { label: "When it runs: short", from: `${sol(snap.shortBase)} SOL`, to: `${sol(o.shortAfter)} SOL` },
      { label: "You receive", to: `${releaseSol} wSOL` },
    ],
    notes: ["Runs once, even with your phone off. Revoke any time before it runs.", ATOMIC, OWNER_ONLY],
    ixs: (n) => n.setRuleIxs(triggerUsd, above, releaseSol, expiry),
  };
};

export const revokeRule = (): Plan => ({
  title: "Revoke rule",
  summary: "Turns the armed rule off. Your SOL and hedge stay as they are.",
  changes: [{ label: "Rule", from: "Armed", to: "Off" }],
  ixs: (n) => n.revokeRuleIxs(),
});

export const closeHedge = (snap: Snapshot): Plan => ({
  title: "Step 1 · Close the hedge",
  summary: "Sets the hedge to 0% and places an order that can only shrink the short. Velocity’s background traders fill it, usually within a minute.",
  changes: [
    { label: "Hedge ratio", from: `${(snap.position?.ratioBps ?? 0) / 100}%`, to: "0%" },
    { label: "SOL-PERP short", from: `${sol(snap.shortBase)} SOL`, to: "0 SOL after the fill" },
  ],
  ixs: async (n) => [...(await n.setRatioIxs(0)), ...(await n.reduceHedgeIxs(snap.shortBase))],
});

export const withdrawSol = (snap: Snapshot): Plan => ({
  title: "Step 2 · Withdraw all SOL",
  summary: "Sends every SOL in custody to your wallet.",
  changes: [
    { label: "SOL in custody", from: `${sol(snap.solLamports)} SOL`, to: "0 SOL" },
    { label: "You receive", to: `${sol(snap.solLamports)} SOL` },
  ],
  notes: [OWNER_ONLY],
  ixs: (n) => n.releaseIxs(snap.solLamports),
});

export const withdrawCollateral = (snap: Snapshot): Plan => ({
  title: "Step 3 · Withdraw collateral",
  summary: "Sends your dUSDT collateral back to your wallet.",
  changes: [{ label: "Collateral", from: `${(Number(snap.collateralBase) / 1e6).toFixed(2)} dUSDT`, to: "0 dUSDT" }],
  ixs: (n) => n.withdrawCollateralIxs(new BN(snap.collateralBase.toString())),
});
