import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { age, ago, sol, until, usd } from "../../format";
import { Header } from "../../header";
import { Icon } from "../../icons";
import { KeeperStatus, keeperStatus } from "../../keeper";
import * as plans from "../../plans";
import { Snapshot } from "../../nelta";
import { useNow } from "../../now";
import { connection, useNelta } from "../../store";
import { color, font, space, tone } from "../../theme";
import { Button, Card, ErrorState, HedgeExplanation, Loading, Notice, Pair, Pill, Row, Segmented, Screen, StalePriceNotice, T } from "../../ui";

function useKeeper(): KeeperStatus | null {
  const [k, setK] = useState<KeeperStatus | null>(null);
  useEffect(() => {
    const load = () => void keeperStatus(connection).then(setK);
    load();
    const id = setInterval(load, 120_000);
    return () => clearInterval(id);
  }, []);
  return k;
}

function KeeperLine({ k }: { k: KeeperStatus | null }) {
  const online = k?.online;
  const t = online ? tone.sync : tone.waiting;
  const label = !k ? "Checking keeper…" : online === null ? "Keeper status unknown" : online ? "Recent keeper check-in" : "No recent keeper check-in";
  const body = !k ? "Reading the keeper’s latest check-in from Devnet." : online === true ? "The keeper has checked in recently. Eligible rules still need a fresh price and a fill." : online === false ? "No recent check-in. Automatic rules may be delayed; you can still use Release or Recovery." : "Couldn’t confirm the keeper’s status. Check your connection; automatic execution isn’t confirmed.";
  return (
    <View style={hs.keeper}>
      <View style={[hs.dot, { backgroundColor: t.fg }]} />
      <View style={{ flex: 1 }}>
        <T v="label" style={{ color: color.text }}>{label}</T>
        <T v="caption">
          {k?.lastSeenTs ? `Last seen on-chain ${ago(k.lastSeenTs)}. ` : ""}
          {body}
        </T>
      </View>
    </View>
  );
}

function RatioCard({ snap, fresh }: { snap: Snapshot; fresh: boolean }) {
  const { propose } = useNelta();
  const current = (snap.position?.ratioBps ?? 0) / 100;
  const [ratio, setRatio] = useState(current);
  return (
    <Card>
      <T v="h2">Hedge ratio</T>
      <T v="caption" style={{ marginTop: space.xs }}>Choose how much of your SOL’s price change to offset. Saved target: {current}%.</T>
      <Segmented options={[25, 50, 75, 100].map((v) => ({ value: v, label: `${v}%` }))} value={ratio} onChange={setRatio} />
      <HedgeExplanation ratioPct={ratio} />
      <Button label="Review change" kind="secondary" disabled={ratio === current || !fresh} onPress={() => propose(plans.changeRatio(snap, ratio * 100))} />
    </Card>
  );
}

function Setup() {
  const { propose } = useNelta();
  const [ratio, setRatio] = useState(50);
  return (
    <Card>
      <T v="h1">Set up Nelta</T>
      <T v="body" style={{ color: color.textMuted, marginTop: space.sm }}>
        A hedge helps offset a fall in SOL’s dollar value. Choose how much of your SOL to cover; Nelta keeps the hedge sized to the SOL you hold.
      </T>
      <Segmented options={[25, 50, 75, 100].map((v) => ({ value: v, label: `${v}%` }))} value={ratio} onChange={setRatio} />
      <HedgeExplanation ratioPct={ratio} />
      <T v="caption" style={{ marginTop: space.sm }}>Next: get free test dUSDT, add the SOL amount you choose, then sync your hedge.</T>
      <Button label="Review setup" onPress={() => propose(plans.createPosition(ratio * 100))} />
    </Card>
  );
}

function SetupSteps({ snap }: { snap: Snapshot }) {
  const steps = [
    { done: true, label: "Create your position" },
    { done: snap.collateralBase > 0n, label: "Get dUSDT collateral for the short" },
    { done: snap.solLamports > 0n, label: "Add SOL to custody" },
    { done: snap.shortBase > 0n && snap.shortBase === snap.targetShort, label: "Sync the hedge" },
  ];
  const next = steps.findIndex((s) => !s.done);
  return (
    <Card>
      <T v="h2">Finish setup · step {next + 1} of {steps.length}</T>
      {steps.map((s, i) => (
        <View key={s.label} style={hs.check}>
          <Icon name={s.done ? "check" : i === next ? "arrow" : "clock"} size={18} tint={s.done ? tone.sync.fg : i === next ? color.brand : color.textMuted} />
          <T v="body" style={s.done ? { color: color.textMuted } : i === next ? { fontFamily: font.semibold } : null}>{s.label}</T>
        </View>
      ))}
      <T v="caption" style={{ marginTop: space.xs }}>Use the button at the bottom for the next step.</T>
    </Card>
  );
}

function MarginLine({ snap }: { snap: Snapshot }) {
  const m = snap.margin;
  const buffer = m.equityUsd - m.requiredUsd;
  const low = m.requiredUsd > 0 && m.equityUsd < m.requiredUsd * 2;
  const t = low ? tone.drift : tone.sync;
  return (
    <View style={[hs.margin, { backgroundColor: t.bg }]}>
      <T v="label" style={{ color: t.fg }}>{low ? "Margin is getting thin" : "Margin is healthy"}</T>
      <T v="caption" style={{ color: t.fg }}>
        ≈ {usd(Math.max(0, buffer))} above what Velocity needs to keep the short open.{" "}
        {m.liquidationPrice === null ? "Your SOL in custody covers the short, so price moves alone can’t liquidate it." : `Velocity would start liquidating if SOL rose to ≈ ${usd(m.liquidationPrice)}.`}
      </T>
    </View>
  );
}

function ExitCard({ snap, fresh }: { snap: Snapshot; fresh: boolean }) {
  const { propose } = useNelta();
  const router = useRouter();
  const canClose = snap.shortBase > 0n || (snap.position?.ratioBps ?? 0) > 0 || snap.position?.rule.active;
  return (
    <Card>
      <T v="h2">Exit</T>
      <T v="caption" style={{ marginTop: space.xs }}>Each exit applies in one transaction. If Velocity can’t fill it, your SOL and hedge stay as they are. A failed transaction sent to Devnet can still cost a network fee.</T>
      <Button label="Keep my SOL, close hedge" kind="secondary" disabled={!fresh || !canClose} onPress={() => propose(plans.exitKeepSol(snap))} />
      <Button label="Release all, close hedge" kind="secondary" disabled={!fresh || snap.solLamports === 0n} onPress={() => propose(plans.exitReleaseAll(snap))} />
      <Button label="Step-by-step recovery" kind="quiet" onPress={() => router.push("/recovery")} />
    </Card>
  );
}

export default function Home() {
  const { nelta, snap, readError, refresh, propose } = useNelta();
  const router = useRouter();
  const keeper = useKeeper();
  const now = useNow();
  const [pulling, setPulling] = useState(false);
  const onPull = async () => {
    setPulling(true);
    await refresh();
    setPulling(false);
  };
  const refreshControl = <RefreshControl refreshing={pulling} onRefresh={() => void onPull()} tintColor={color.brand} />;

  if (!snap)
    return (
      <Screen refresh={refreshControl}>
        <Header />
        {readError ? <ErrorState title="Couldn’t read Devnet" body={`${readError}. Your funds aren’t affected.`} onRetry={() => void onPull()} retrying={pulling} /> : <Loading label="Reading your position from Devnet…" />}
      </Screen>
    );

  const pos = snap.position;
  if (!pos)
    return (
      <Screen refresh={refreshControl}>
        <Header />
        <Setup />
      </Screen>
    );

  const inSync = snap.shortBase === snap.targetShort;
  const rule = pos.rule;
  const ruleLive = rule.active && rule.expiryTs.toNumber() > now;
  const needsCollateral = snap.collateralBase === 0n;
  const needsSol = snap.solLamports === 0n;
  const belowTradeSize = !needsSol && pos.ratioBps > 0 && snap.targetShort === 0n && snap.shortBase === 0n;
  const fresh = !!nelta?.oracleFresh(snap);
  const liquidating = snap.venueStatus.liquidating;
  const canAddRisk = fresh && !liquidating;
  const solValue = (Number(snap.solLamports) / 1e9) * snap.price;

  const primary = needsCollateral ? (
    snap.walletDusdt > 0 ? (
      <Button label={`Add ${snap.walletDusdt.toFixed(2)} dUSDT collateral`} onPress={() => propose(plans.depositDusdt(snap))} />
    ) : (
      <Button label={`Get ${plans.TEST_DUSDT} test dUSDT collateral`} onPress={() => propose(plans.faucetCollateral(snap))} />
    )
  ) : needsSol || belowTradeSize ? (
    <Button label="Add SOL" onPress={() => router.push("/funds")} />
  ) : !inSync ? (
    <Button label="Sync hedge" icon="link" disabled={!canAddRisk} onPress={() => propose(plans.syncHedge(snap))} />
  ) : !ruleLive ? (
    <Button label="Arm a rule" icon="zap" disabled={!canAddRisk} onPress={() => router.push("/rule")} />
  ) : (
    <Button label="Release now" kind="secondary" disabled={!fresh} onPress={() => router.push("/release")} />
  );

  return (
    <Screen refresh={refreshControl} footer={primary}>
      <Header />
      {readError && <Notice tone="waiting" title="Showing the last reading" body="Devnet is slow to answer. Pull down to refresh." />}
      {!fresh && <StalePriceNotice ageSecs={snap.oracleAgeSecs} />}
      {liquidating ? (
        <Notice tone="failed" title="Needs attention: Velocity is liquidating your short" body="Collateral got too thin for the short. Nelta won’t add risk until it’s over. You can still release SOL or use Recovery." />
      ) : snap.venueStatus.liquidations > 0 && !inSync && snap.shortBase < snap.targetShort ? (
        <Notice tone="drift" title="Needs attention: short below target" body={`Adding SOL does this, but Velocity has also liquidated this account before (${snap.venueStatus.liquidations}×). Check your margin below before you sync, or exit.`} />
      ) : null}

      <T v="label" style={{ marginTop: space.md }}>SOL in custody</T>
      <T v="hero">{sol(snap.solLamports)} SOL</T>
      <T v="caption">
        ≈ {usd(solValue)} at {usd(snap.price)} · price {age(Math.max(0, snap.oracleAgeSecs))} old
      </T>

      <Card>
        <Pair
          custody={Number(snap.solLamports) / 1e9}
          shortNow={Number(snap.shortBase) / 1e9}
          target={Number(snap.targetShort) / 1e9}
          inSync={inSync}
          ratioPct={pos.ratioBps / 100}
        />
        {snap.shortBase > 0n && <MarginLine snap={snap} />}
        {!inSync && !needsCollateral && (
          <T v="caption" style={{ marginTop: space.md, color: tone.drift.fg }}>
            Your short doesn’t match the SOL Nelta holds. Sync it so a release can shrink both together.
          </T>
        )}
      </Card>

      {belowTradeSize && <Notice tone="waiting" title="Not enough SOL for a hedge yet" body="Your chosen hedge rounds down to zero at Velocity’s minimum trade size. Add more SOL or choose a higher percentage below. No short is open yet." />}
      {(needsCollateral || needsSol || belowTradeSize || (!inSync && snap.shortBase === 0n)) && <SetupSteps snap={snap} />}

      <Card tint={ruleLive ? tone.armed.bg : undefined}>
        <View style={hs.between}>
          <T v="h2">One-use rule</T>
          <Pill tone={ruleLive ? "armed" : "waiting"} label={ruleLive ? "Armed" : "Not armed"} icon={ruleLive ? "zap" : undefined} />
        </View>
        {ruleLive ? (
          <>
            <T v="body" style={{ marginTop: space.sm }}>
              If SOL {rule.above ? "rises to" : "falls to"} {usd(rule.triggerPrice.toNumber() / 1e6)}, release {sol(rule.releaseLamports.toNumber())} SOL and shrink the short to match.
            </T>
            <T v="caption" style={{ marginTop: space.xs }}>Expires in {until(rule.expiryTs.toNumber())} · now {usd(snap.price)}</T>
          </>
        ) : (
          <T v="caption" style={{ marginTop: space.sm }}>Arm a rule and Nelta can act while your phone is off.</T>
        )}
        <KeeperLine k={keeper} />
      </Card>

      {!needsCollateral && <RatioCard snap={snap} fresh={canAddRisk} />}
      {(snap.shortBase > 0n || snap.solLamports > 0n) && <ExitCard snap={snap} fresh={fresh} />}

      <Card>
        {snap.ownerWsol > 0 && <Row label="Wrapped SOL from rules, in your wallet" value={`${snap.ownerWsol.toFixed(4)} wSOL`} />}
        <Row label="Collateral" value={`${(Number(snap.collateralBase) / 1e6).toFixed(2)} dUSDT`} />
        <View style={hs.actions}>
          <View style={{ flex: 1 }}><Button label="Release" kind="secondary" disabled={needsSol || !fresh} onPress={() => router.push("/release")} /></View>
          <View style={{ flex: 1 }}><Button label="Add funds" kind="secondary" onPress={() => router.push("/funds")} /></View>
        </View>
        {snap.shortBase === 0n && snap.solLamports === 0n && snap.collateralBase > 0n && (
          <Button label="Withdraw dUSDT collateral" kind="quiet" onPress={() => router.push("/recovery")} />
        )}
      </Card>
    </Screen>
  );
}

const hs = StyleSheet.create({
  keeper: { flexDirection: "row", gap: space.md, marginTop: space.lg, paddingTop: space.md, borderTopWidth: 1, borderColor: color.border, alignItems: "flex-start" },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  check: { flexDirection: "row", gap: space.md, alignItems: "center", minHeight: 36 },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  actions: { flexDirection: "row", gap: space.md },
  margin: { marginTop: space.md, padding: space.md, borderRadius: 10, gap: 2 },
});
