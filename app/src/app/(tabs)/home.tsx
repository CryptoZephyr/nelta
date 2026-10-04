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
import { color, space, tone } from "../../theme";
import { Button, Card, Notice, Pair, Pill, Row, Segmented, Screen, T } from "../../ui";

const STALE_PRICE_SECS = 120;

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
  const label = !k ? "Checking keeper…" : online === null ? "Keeper status unknown" : online ? "Keeper online" : "Keeper offline";
  return (
    <View style={hs.keeper}>
      <View style={[hs.dot, { backgroundColor: t.fg }]} />
      <View style={{ flex: 1 }}>
        <T v="label" style={{ color: color.text }}>{label}</T>
        <T v="caption">
          {k?.lastSeenTs ? `Last seen on-chain ${ago(k.lastSeenTs)}. ` : ""}
          {online ? "Watching the price while your phone is off." : "Your SOL is safe; armed rules wait until it’s back."}
        </T>
      </View>
    </View>
  );
}

function RatioCard({ snap }: { snap: Snapshot }) {
  const { propose } = useNelta();
  const current = (snap.position?.ratioBps ?? 0) / 100;
  const [ratio, setRatio] = useState(current);
  return (
    <Card>
      <T v="h2">Hedge ratio</T>
      <T v="caption" style={{ marginTop: space.xs }}>How much of the SOL in custody the short covers. Now {current}%.</T>
      <Segmented options={[25, 50, 75, 100].map((v) => ({ value: v, label: `${v}%` }))} value={ratio} onChange={setRatio} />
      <Button label="Review change" kind="secondary" disabled={ratio === current} onPress={() => propose(plans.changeRatio(snap, ratio * 100))} />
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
        Choose how much of your SOL to hedge with a SOL-PERP short. Nelta keeps the two in step.
      </T>
      <Segmented options={[25, 50, 75, 100].map((v) => ({ value: v, label: `${v}%` }))} value={ratio} onChange={setRatio} />
      <Button label="Review" onPress={() => propose(plans.createPosition(ratio * 100))} />
    </Card>
  );
}

export default function Home() {
  const { snap, readError, refresh, propose } = useNelta();
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
        {readError ? <Notice tone="failed" title="Couldn’t read Devnet" body={`${readError}. Pull down to try again.`} /> : <T v="caption">Reading your position from Devnet…</T>}
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
  const solValue = (Number(snap.solLamports) / 1e9) * snap.price;

  const primary = needsCollateral || needsSol ? (
    <Button label={needsCollateral ? "Add dUSDT collateral" : "Add SOL"} onPress={() => router.push("/funds")} />
  ) : !inSync ? (
    <Button label="Sync hedge" icon="link" onPress={() => propose(plans.syncHedge(snap))} />
  ) : !ruleLive ? (
    <Button label="Arm a rule" icon="zap" onPress={() => router.push("/rule")} />
  ) : (
    <Button label="Release now" kind="secondary" onPress={() => router.push("/release")} />
  );

  return (
    <Screen refresh={refreshControl} footer={primary}>
      <Header />
      {readError && <Notice tone="waiting" title="Showing the last reading" body="Devnet is slow to answer. Pull down to refresh." />}
      {!readError && snap.oracleAgeSecs > STALE_PRICE_SECS && (
        <Notice tone="drift" icon="clock" title="Needs attention" body={`Velocity’s price feed hasn’t updated for ${age(snap.oracleAgeSecs)}. Hedge changes and rules wait until it’s fresh. Your SOL is safe and nothing will move.`} />
      )}

      <T v="label" style={{ marginTop: space.md }}>SOL in custody</T>
      <T v="hero">{sol(snap.solLamports)} SOL</T>
      <T v="caption">
        ≈ {usd(solValue)} at {usd(snap.price)} · price {age(snap.oracleAgeSecs)} old
      </T>

      <Card>
        <Pair
          custody={Number(snap.solLamports) / 1e9}
          shortNow={Number(snap.shortBase) / 1e9}
          target={Number(snap.targetShort) / 1e9}
          inSync={inSync}
          ratioPct={pos.ratioBps / 100}
        />
        {!inSync && !needsCollateral && (
          <T v="caption" style={{ marginTop: space.md, color: tone.drift.fg }}>
            Your short doesn’t match the SOL Nelta holds. Sync it so a release can shrink both together.
          </T>
        )}
      </Card>

      {(needsCollateral || needsSol) && (
        <Card>
          <T v="h2">Finish setup</T>
          {[
            { done: true, label: "Position created" },
            { done: !needsCollateral, label: "Add dUSDT collateral for the short" },
            { done: !needsSol, label: "Add SOL to custody" },
            { done: inSync && !needsSol, label: "Sync the hedge" },
          ].map((s) => (
            <View key={s.label} style={hs.check}>
              <Icon name={s.done ? "check" : "clock"} size={18} tint={s.done ? tone.sync.fg : color.textMuted} />
              <T v="body" style={s.done ? { color: color.textMuted } : null}>{s.label}</T>
            </View>
          ))}
        </Card>
      )}

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

      {!needsCollateral && <RatioCard snap={snap} />}

      <Card>
        <Row label="Released to your wallet" value={`${snap.ownerWsol.toFixed(4)} wSOL`} />
        <Row label="Collateral" value={`${(Number(snap.collateralBase) / 1e6).toFixed(2)} dUSDT`} />
        <View style={hs.actions}>
          <View style={{ flex: 1 }}><Button label="Release" kind="secondary" disabled={needsSol} onPress={() => router.push("/release")} /></View>
          <View style={{ flex: 1 }}><Button label="Add funds" kind="secondary" onPress={() => router.push("/funds")} /></View>
        </View>
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
});
