import { useState } from "react";
import { sol } from "../format";
import { LAMPORTS } from "../nelta";
import * as plans from "../plans";
import { useNelta } from "../store";
import { color, space } from "../theme";
import { Button, Card, Field, Notice, Row, Screen, T } from "../ui";

const FEE_BUFFER = 0.01 * LAMPORTS;

export default function Funds() {
  const { snap, propose } = useNelta();
  const [amount, setAmount] = useState("0.1001");
  if (!snap?.position) return <Screen><T v="body">Create your position on Home first.</T></Screen>;

  const lamports = Math.round(Number(amount) * LAMPORTS);
  const error = !amount ? null : !(lamports > 0) ? "Enter an amount above 0." : lamports > snap.walletLamports - FEE_BUFFER ? `Keep some SOL for fees. Your wallet has ${sol(snap.walletLamports, 3)} SOL.` : null;

  return (
    <Screen>
      <T v="h1">Add funds</T>
      <Card>
        <Row label="Wallet SOL" value={`${sol(snap.walletLamports, 3)} SOL`} />
        <Row label="Wallet dUSDT" value={`${snap.walletDusdt.toFixed(2)} dUSDT`} />
        <Row label="Collateral on Velocity" value={`${(Number(snap.collateralBase) / 1e6).toFixed(2)} dUSDT`} />
      </Card>

      <Card>
        <T v="h2">Collateral</T>
        <T v="caption" style={{ marginTop: space.xs }}>dUSDT backs the short. Add it before syncing the hedge.</T>
        {snap.walletDusdt > 0 ? (
          <Button label={`Review: add ${snap.walletDusdt.toFixed(2)} dUSDT`} kind="secondary" onPress={() => propose(plans.depositDusdt(snap))} />
        ) : (
          <Notice tone="waiting" title="No dUSDT in this wallet" body="Get Devnet dUSDT for this wallet, then come back." />
        )}
      </Card>

      <Card>
        <T v="h2">SOL</T>
        <Field label="Amount" unit="SOL" value={amount} onChange={setAmount} error={error} />
        <Button label="Review deposit" disabled={!!error || !(lamports > 0)} onPress={() => propose(plans.depositSol(snap, lamports))} />
        <T v="caption" style={{ marginTop: space.sm, color: color.textMuted }}>After depositing, sync the hedge from Home.</T>
      </Card>
    </Screen>
  );
}
