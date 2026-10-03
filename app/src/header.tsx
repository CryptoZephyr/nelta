import { useRouter } from "expo-router";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { short } from "./format";
import { Icon, Mark } from "./icons";
import { useNelta } from "./store";
import { color, font, space } from "./theme";
import { Pill, T } from "./ui";

export function Header({ title }: { title?: string }) {
  const { owner, disconnectWallet } = useNelta();
  const router = useRouter();
  const addr = owner?.toBase58() ?? "";
  return (
    <View style={hs.wrap}>
      <View style={hs.left}>
        <Mark size={26} />
        <T v="h2" style={{ fontFamily: font.display, fontSize: 24 }}>{title ?? "Nelta"}</T>
        <Pill tone="waiting" label="Devnet" />
      </View>
      <View style={hs.left}>
        <Pressable
          onPress={() => Alert.alert("Wallet", addr, [{ text: "Keep" }, { text: "Disconnect", style: "destructive", onPress: disconnectWallet }])}
          style={hs.chip}
          accessibilityLabel={`Wallet ${addr}`}
        >
          <T v="mono" style={{ color: color.text }}>{short(addr)}</T>
        </Pressable>
        <Pressable onPress={() => router.push("/recovery")} style={hs.icon} accessibilityLabel="Recovery">
          <Icon name="lifebuoy" size={22} />
        </Pressable>
      </View>
    </View>
  );
}

const hs = StyleSheet.create({
  wrap: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: space.md },
  left: { flexDirection: "row", alignItems: "center", gap: space.sm },
  chip: { minHeight: 36, justifyContent: "center", paddingHorizontal: space.md, borderRadius: 999, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});
