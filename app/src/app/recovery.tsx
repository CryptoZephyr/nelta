import { StyleSheet, View } from "react-native";
import { sol } from "../format";
import { Icon } from "../icons";
import * as plans from "../plans";
import { useNelta } from "../store";
import { color, space, tone } from "../theme";
import { Button, Card, Notice, Screen, T } from "../ui";

export default function Recovery() {
  const { snap, propose } = useNelta();
  if (!snap?.position) return <Screen><T v="body">There’s no position to recover.</T></Screen>;

  const ratio = snap.position.ratioBps;
  const steps = [
    {
      title: "Close the hedge",
      body: `Short is ${sol(snap.shortBase)} SOL. Places an order that can only shrink it; Velocity fills it, usually within a minute.`,
      done: snap.shortBase === 0n && ratio === 0,
      ready: snap.shortBase > 0n || ratio > 0,
      plan: () => plans.closeHedge(snap),
    },
    {
      title: "Withdraw all SOL",
      body: `${sol(snap.solLamports)} SOL in custody goes to your wallet.`,
      done: snap.solLamports === 0n,
      ready: snap.shortBase === 0n && snap.solLamports > 0n,
      plan: () => plans.withdrawSol(snap),
    },
    {
      title: "Withdraw collateral",
      body: `${(Number(snap.collateralBase) / 1e6).toFixed(2)} dUSDT goes back to your wallet.`,
      done: snap.collateralBase === 0n,
      ready: snap.shortBase === 0n && snap.collateralBase > 0n,
      plan: () => plans.withdrawCollateral(snap),
    },
  ];
  const next = steps.findIndex((s) => !s.done);

  return (
    <Screen>
      <T v="h1">Get everything back</T>
      <T v="body" style={{ color: color.textMuted }}>Three steps, signed by your wallet. They call the Nelta program directly and don’t need the keeper or any Nelta server.</T>
      {next === -1 && <Notice tone="sync" icon="check" title="All withdrawn" body="Nothing is left in Nelta." />}
      {steps.map((s, i) => (
        <Card key={s.title} style={i === next ? { borderColor: color.brand } : null}>
          <View style={rs.head}>
            <View style={[rs.num, s.done && { backgroundColor: tone.sync.fg, borderColor: tone.sync.fg }]}>
              {s.done ? <Icon name="check" size={14} tint="#fff" /> : <T v="label" style={{ color: color.text }}>{i + 1}</T>}
            </View>
            <T v="h2">{s.title}</T>
          </View>
          <T v="caption" style={{ marginTop: space.xs }}>{s.done ? "Done." : s.body}</T>
          {!s.done && i === next && <Button label="Review" kind="secondary" disabled={!s.ready} onPress={() => propose(s.plan())} />}
          {!s.done && i === next && !s.ready && <T v="caption" style={{ marginTop: space.xs }}>Waiting for the close order to fill. Pull to refresh on Home.</T>}
        </Card>
      ))}
    </Screen>
  );
}

const rs = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  num: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: color.border, alignItems: "center", justifyContent: "center" },
});
