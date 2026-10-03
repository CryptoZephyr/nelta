import { Redirect } from "expo-router";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Mark } from "../icons";
import { useNelta } from "../store";
import { color, space } from "../theme";
import { Button, Notice, Pill, T } from "../ui";

function PairArt() {
  return (
    <View style={w.art} accessibilityElementsHidden>
      <View style={[w.bar, { width: "88%", backgroundColor: color.brand }]} />
      <View style={w.link} />
      <View style={[w.bar, { width: "44%", backgroundColor: color.hedge }]} />
    </View>
  );
}

export default function Welcome() {
  const { owner, connectWallet, connecting, connectError } = useNelta();
  if (owner) return <Redirect href="/home" />;
  return (
    <SafeAreaView style={w.root}>
      <View style={w.top}>
        <Mark size={32} />
        <Pill tone="waiting" label="Devnet · Mobile Wallet Adapter" />
      </View>
      <View style={w.body}>
        <T v="hero">Sell SOL.{"\n"}Your hedge follows.</T>
        <PairArt />
        <T v="body" style={{ color: color.textMuted }}>
          Set a one-use rule like “if SOL rises to $210, release 0.04 SOL”. A keeper runs it while your phone is off. It can only shrink your position, and the SOL can only go to your wallet.
        </T>
      </View>
      <View>
        {connectError && <Notice tone="waiting" title={connectError} body="Nothing was signed. Try again when you’re ready." />}
        <Button label="Connect wallet" icon="wallet" loading={connecting} onPress={() => void connectWallet()} />
        <T v="caption" style={{ textAlign: "center", marginTop: space.md }}>Test network only. No real funds.</T>
      </View>
    </SafeAreaView>
  );
}

const w = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg, padding: space.xl, justifyContent: "space-between" },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  body: { gap: space.xl },
  art: { paddingVertical: space.lg },
  bar: { height: 14, borderRadius: 7 },
  link: { width: 2, height: 22, backgroundColor: color.brand, marginLeft: 24, opacity: 0.4 },
});
