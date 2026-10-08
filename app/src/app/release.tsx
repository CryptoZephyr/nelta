import { useState } from "react";
import { View } from "react-native";
import { sol, toLamports } from "../format";
import * as plans from "../plans";
import { useNelta } from "../store";
import { color, space } from "../theme";
import { PositionGate } from "../gate";
import { useNow } from "../now";
import { Button, Card, Field, Notice, Row, Screen, Segmented, StalePriceNotice, T } from "../ui";

export default function Release() {
  const { nelta, snap, propose } = useNelta();
  useNow();
  const [amount, setAmount] = useState("0.04");
  const pos = snap?.position;
  if (!snap || !pos) return <Screen><PositionGate snap={snap} /></Screen>;

  const inSync = snap.shortBase === snap.targetShort;
  const fresh = !!nelta?.oracleFresh(snap);
  const lamports = toLamports(amount);
  const error = !amount ? null : !lamports ? "Enter an amount above 0." : lamports > snap.solLamports ? `Nelta holds ${sol(snap.solLamports)} SOL.` : null;
  const outcome = lamports && !error ? plans.releaseOutcome(snap, pos.ratioBps, lamports) : null;
  const pick = (f: number) => setAmount(sol((snap.solLamports * BigInt(f)) / 100n, 9));

  return (
    <Screen footer={<Button label="Review release" disabled={!outcome || !inSync || !fresh} onPress={() => lamports && propose(plans.release(snap, lamports))} />}>
      <T v="h1">Release SOL</T>
      <T v="body" style={{ color: color.textMuted }}>Shrinks the short and sends SOL to your wallet in one transaction. If the hedge can’t be reduced, nothing moves.</T>
      {!fresh && <StalePriceNotice ageSecs={snap.oracleAgeSecs} />}
      {!inSync && <Notice tone="drift" title="Sync the hedge first" body="Your short doesn’t match the SOL Nelta holds. Sync it from Home, then release." />}
      <Card>
        <Field label="Amount" unit="SOL" value={amount} onChange={setAmount} error={error} hint={`Nelta holds ${sol(snap.solLamports)} SOL.`} />
        <Segmented options={[25, 50, 100].map((v) => ({ value: v, label: v === 100 ? "All" : `${v}%` }))} value={-1} onChange={pick} />
      </Card>
      {outcome && (
        <Card>
          <T v="h2">After release</T>
          <View style={{ marginTop: space.sm }}>
            <Row label="SOL in custody" value={`${sol(snap.solLamports)} → ${sol(outcome.custodyAfter)}`} />
            <Row label="SOL-PERP short" value={`${sol(snap.shortBase)} → ${sol(outcome.shortAfter)}`} />
            <Row label="You receive" value={`${sol(lamports!)} SOL`} strong />
          </View>
        </Card>
      )}
    </Screen>
  );
}
