import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "./icons";
import { color, font, radius, space } from "./theme";
import { T } from "./ui";

const LATEST = "https://api.github.com/repos/CryptoZephyr/nelta/releases/latest";

interface Release {
  tag_name: string;
  html_url: string;
  assets: { name: string; browser_download_url: string }[];
}

const parts = (v: string) => v.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);

export function isNewer(latest: string, current: string): boolean {
  const a = parts(latest);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

function useUpdate(): { version: string; url: string } | null {
  const [update, setUpdate] = useState<{ version: string; url: string } | null>(null);
  useEffect(() => {
    const current = Constants.expoConfig?.version;
    if (!current) return;
    let live = true;
    fetch(LATEST, { headers: { Accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? (r.json() as Promise<Release>) : null))
      .then((rel) => {
        if (!live || !rel || !isNewer(rel.tag_name, current)) return;
        const apk = rel.assets.find((a) => a.name.endsWith(".apk"));
        setUpdate({ version: rel.tag_name.replace(/^v/, ""), url: apk?.browser_download_url ?? rel.html_url });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return update;
}

export function UpdateBanner() {
  const update = useUpdate();
  const [hidden, setHidden] = useState(false);
  const insets = useSafeAreaInsets();
  if (!update || hidden) return null;
  return (
    <View style={[u.bar, { paddingTop: insets.top + space.sm }]}>
      <Icon name="arrow" size={16} tint={color.onBrand} />
      <T v="label" style={u.text}>Nelta {update.version} is available</T>
      <Pressable onPress={() => void Linking.openURL(update.url)} style={u.btn} accessibilityRole="button">
        <T v="label" style={u.btnText}>Update</T>
      </Pressable>
      <Pressable onPress={() => setHidden(true)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Dismiss">
        <Icon name="x" size={16} tint={color.onBrand} />
      </Pressable>
    </View>
  );
}

const u = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: color.brand, paddingHorizontal: space.lg, paddingBottom: space.sm },
  text: { flex: 1, color: color.onBrand },
  btn: { backgroundColor: color.onBrand, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs },
  btnText: { color: color.brand, fontFamily: font.semibold },
});
