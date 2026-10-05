import { useState } from "react";
import { View } from "react-native";
import { sol } from "../format";
import { LAMPORTS } from "../nelta";
import * as plans from "../plans";
import { useNelta } from "../store";
import { color, space, tone } from "../theme";
import { Button, Card, Field, Notice, Pill, Row, Screen, T } from "../ui";

const FEE_BUFFER = 0.01 * LAMPORTS;

export default function Funds() {
  const { snap, propose } = useNelta();
  const [amount, setAmount] = useState("0.1");
  if (!snap?.position) return <Screen><T v="body">Create your position on Home first.</T></Screen>;

  const needsCollateral = snap.collateralBase === 0n;
  const lamports = Math.round(Number(amount) * LAMPORTS);
  const error = !amount ? null : !(lamports > 0) ? "Enter an amount above 0." : lamports > snap.walletLamports - FEE_BUFFER ? `Keep some SOL for fees. Your wallet has ${sol(snap.walletLamports, 3)} SOL.` : null;
  const collateral = (Number(snap.collateralBase) / 1e6).toFixed(2);

  return (
    <Screen>
      <T v="h1">Add funds</T>
      <T v="body" style={{ color: color.textMuted }}>Two separate steps: dUSDT collateral backs the short, and SOL goes into custody. One doesn’t create the other.</T>

      <Card style={needsCollateral ? { borderColor: color.brand } : null}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <T v="h2">1 · dUSDT collateral</T>
          <Pill tone={needsCollateral ? "waiting" : "sync"} label={needsCollateral ? "To do" : "Done"} icon={needsCollateral ? undefined : "check"} />
        </View>
        <Row label="On Velocity" value={`${collateral} dUSDT`} />
        <Row label="In your wallet" value={`${snap.walletDusdt.toFixed(2)} dUSDT`} />
        {snap.walletDusdt > 0 && <Button label={`Review: add ${snap.walletDusdt.toFixed(2)} dUSDT from your wallet`} kind={needsCollateral ? "primary" : "secondary"} onPress={() => propose(plans.depositDusdt(snap))} />}
        <Button label={`Get ${plans.TEST_DUSDT} free test dUSDT`} kind={needsCollateral && snap.walletDusdt === 0 ? "primary" : "secondary"} onPress={() => propose(plans.faucetCollateral(snap))} />
        <T v="caption" style={{ marginTop: space.sm }}>Devnet test tokens from Velocity’s faucet. No value, only the network fee.</T>
      </Card>

      <Card style={!needsCollateral && snap.solLamports === 0n ? { borderColor: color.brand } : null}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <T v="h2">2 · SOL to custody</T>
          <Pill tone={snap.solLamports > 0n ? "sync" : "waiting"} label={snap.solLamports > 0n ? `${sol(snap.solLamports)} SOL` : "To do"} />
        </View>
        {needsCollateral ? (
          <Notice tone="drift" title="Add collateral first" body="The short needs dUSDT behind it. Get test dUSDT above, then add SOL." />
        ) : (
          <>
            <Row label="Wallet" value={`${sol(snap.walletLamports, 3)} SOL`} />
            <Field label="Amount" unit="SOL" value={amount} onChange={setAmount} error={error} />
            <Button label="Review deposit" disabled={!!error || !(lamports > 0)} onPress={() => propose(plans.depositSol(snap, lamports))} />
            <T v="caption" style={{ marginTop: space.sm, color: tone.waiting.fg }}>Next: Sync hedge on Home opens the short.</T>
          </>
        )}
      </Card>
    </Screen>
  );
}
