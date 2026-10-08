import { useState } from "react";
import { View } from "react-native";
import { sol, toLamports, until, usd } from "../../format";
import { PositionGate } from "../../gate";
import { Header } from "../../header";
import { PRICE_PRECISION } from "../../nelta";
import * as plans from "../../plans";
import { useNelta } from "../../store";
import { useNow } from "../../now";
import { color, space, tone } from "../../theme";
import { Button, Card, Field, Notice, Pill, Row, Screen, Segmented, StalePriceNotice, T } from "../../ui";

const EXPIRY = [
  { value: 6, label: "6 h" },
  { value: 24, label: "24 h" },
  { value: 72, label: "3 d" },
  { value: 168, label: "7 d" },
];

export default function Rule() {
  const { nelta, snap, propose } = useNelta();
  const [above, setAbove] = useState(true);
  const [trigger, setTrigger] = useState("");
  const [amount, setAmount] = useState("0.04");
  const [hours, setHours] = useState(24);
  const now = useNow();

  const pos = snap?.position;
  if (!snap || !pos)
    return (
      <Screen>
        <Header />
        <PositionGate snap={snap} />
      </Screen>
    );

  const rule = pos.rule;
  const live = rule.active && rule.expiryTs.toNumber() > now;

  if (live) {
    const triggerUsd = rule.triggerPrice.toNumber() / 1e6;
    const gap = triggerUsd - snap.price;
    return (
      <Screen footer={<Button label="Revoke rule" kind="danger" onPress={() => propose(plans.revokeRule())} />}>
        <Header />
        <Card tint={tone.armed.bg}>
          <Pill tone="armed" label="Armed" icon="zap" />
          <T v="h1" style={{ marginTop: space.md }}>
            If SOL {rule.above ? "rises to" : "falls to"} {usd(triggerUsd)}, release {sol(rule.releaseLamports.toNumber())} SOL and shrink my short to match.
          </T>
          <View style={{ marginTop: space.lg }}>
            <Row label="SOL now" value={usd(snap.price)} />
            <Row label="Distance to trigger" value={`${gap >= 0 ? "+" : "−"}${usd(Math.abs(gap))}`} />
            <Row label="Expires in" value={until(rule.expiryTs.toNumber())} />
            <Row label="Rule number" value={`#${pos.ruleNonce.toString()}`} />
          </View>
        </Card>
        <Notice tone="sync" icon="shield" title="Safe to close the app" body="The keeper runs this once, even with your phone off. It can only shrink your position, and the SOL can only go to your wallet." />
      </Screen>
    );
  }

  const triggerUsd = Number(trigger);
  const releaseSol = Number(amount);
  const lamports = toLamports(amount);
  const amountError = !amount ? null : !lamports ? "Enter a valid SOL amount above 0." : lamports > snap.solLamports ? `Nelta holds ${sol(snap.solLamports)} SOL.` : null;
  const triggerPrice = Math.round(triggerUsd * PRICE_PRECISION);
  const triggerError = !trigger ? null : !Number.isSafeInteger(triggerPrice) || triggerPrice <= 0 ? "Enter a valid price above $0." : null;
  const runsNow = triggerUsd > 0 && (above ? snap.price >= triggerUsd : snap.price <= triggerUsd);
  const ready = !!lamports && triggerUsd > 0 && !amountError && !triggerError;
  const fresh = !!nelta?.oracleFresh(snap);
  const outcome = ready && lamports ? plans.releaseOutcome(snap, pos.ratioBps, lamports) : null;

  return (
    <Screen footer={<Button label="Review rule" icon="zap" disabled={!ready || !fresh} onPress={() => propose(plans.armRule(snap, triggerUsd, above, releaseSol, hours))} />}>
      <Header />
      <T v="h1">Write a rule</T>
      <T v="body" style={{ color: color.textMuted }}>One rule at a time. It runs once, then turns itself off.</T>
      {!fresh && <StalePriceNotice ageSecs={snap.oracleAgeSecs} />}
      <Card>
        <T v="label">If SOL</T>
        <Segmented options={[{ value: true, label: "rises to" }, { value: false, label: "falls to" }]} value={above} onChange={setAbove} />
        <Field label="Price" unit="USD" value={trigger} onChange={setTrigger} placeholder={snap.price.toFixed(2)} hint={`SOL is ${usd(snap.price)} now.`} error={triggerError} />
        <Field label="Release" unit="SOL" value={amount} onChange={setAmount} hint={`Nelta holds ${sol(snap.solLamports)} SOL.`} error={amountError} />
        <T v="label" style={{ marginTop: space.lg }}>Expires in</T>
        <Segmented options={EXPIRY} value={hours} onChange={setHours} />
      </Card>
      {runsNow && <Notice tone="drift" title="This would run right away" body={`SOL is already ${above ? "at or above" : "at or below"} ${usd(triggerUsd)}.`} />}
      {outcome && (
        <Card>
          <T v="h2">When it runs</T>
          <T v="body" style={{ marginTop: space.xs }}>
            If SOL {above ? "rises to" : "falls to"} {usd(triggerUsd)}, release {releaseSol} SOL and shrink my short to match. Expires in {EXPIRY.find((e) => e.value === hours)?.label}.
          </T>
          <View style={{ marginTop: space.md }}>
            <Row label="SOL in custody" value={`${sol(snap.solLamports)} → ${sol(outcome.custodyAfter)}`} />
            <Row label="SOL-PERP short" value={`${sol(snap.shortBase)} → ${sol(outcome.shortAfter)}`} />
            <Row label="You receive" value={`${releaseSol} wSOL`} strong />
          </View>
        </Card>
      )}
    </Screen>
  );
}
