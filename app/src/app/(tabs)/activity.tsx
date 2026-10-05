import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { Activity, activity } from "../../activity";
import { ago, explorerTx, short } from "../../format";
import { Header } from "../../header";
import { Icon } from "../../icons";
import { connection, useNelta } from "../../store";
import { color, space, tone } from "../../theme";
import { Card, ErrorState, Loading, Pill, Screen, T } from "../../ui";

export default function ActivityScreen() {
  const { nelta, owner, version } = useNelta();
  const [items, setItems] = useState<Activity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!nelta || !owner) return;
    try {
      setItems(await activity(connection, nelta.position, owner));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [nelta, owner]);

  const pull = async () => {
    setLoading(true);
    await load();
    setLoading(false);
  };

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, version]);

  return (
    <Screen refresh={<RefreshControl refreshing={loading} onRefresh={() => void pull()} tintColor={color.brand} />}>
      <Header />
      <T v="h1">Activity</T>
      <T v="body" style={{ color: color.textMuted }}>Every change to your position, and who made it. Tap one to see it on Solana Explorer.</T>
      {error && <ErrorState title="Couldn’t load activity" body="Devnet is busy. Your funds aren’t affected." onRetry={() => void pull()} retrying={loading} />}
      {!items && !error && <Loading label="Loading your activity from Devnet…" />}
      {items?.length === 0 && <T v="caption" style={{ marginTop: space.lg }}>Nothing yet. Every approval you make, and every keeper run, shows up here with a Devnet link.</T>}
      {items && items.length > 0 && (
        <Card style={{ paddingVertical: space.sm }}>
          {items.map((a, i) => (
            <Pressable
              key={a.sig}
              onPress={() => void Linking.openURL(explorerTx(a.sig))}
              style={[as.item, i > 0 && as.divider]}
              accessibilityRole="link"
              accessibilityLabel={`${a.what} by ${a.by}`}
            >
              <View style={[as.icon, { backgroundColor: a.by === "keeper" ? tone.ran.bg : color.surfaceMuted }]}>
                <Icon name={a.by === "keeper" ? "zap" : "wallet"} size={18} tint={a.by === "keeper" ? tone.ran.fg : color.textMuted} />
              </View>
              <View style={{ flex: 1 }}>
                <T v="label" style={{ color: a.ok ? color.text : color.textMuted }}>{a.ok ? a.what : "Try that didn’t fill"}</T>
                <T v="caption">
                  {a.by === "keeper" ? "Keeper, no phone needed" : "You"} · {a.ts ? ago(a.ts) : "pending"}
                </T>
                <T v="mono">{short(a.sig, 6)}</T>
              </View>
              {a.ok ? a.by === "keeper" && <Pill tone="ran" label="Offline run" /> : <Pill tone="waiting" label="Nothing changed" />}
            </Pressable>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const as = StyleSheet.create({
  item: { flexDirection: "row", gap: space.md, paddingVertical: space.md, alignItems: "center", minHeight: 56 },
  divider: { borderTopWidth: 1, borderColor: color.border },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
});
