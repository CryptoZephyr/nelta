import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { Animated, Easing, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Icon, IconName, Mark } from "../icons";
import { useNelta } from "../store";
import { color, radius, space, tone } from "../theme";
import { Button, Notice, Pill, T } from "../ui";

const ease = Easing.out(Easing.cubic);

function useStory() {
  const [v] = useState(() => ({
    intro: new Animated.Value(0),
    shrink: new Animated.Value(0),
    payout: new Animated.Value(0),
    points: [0, 1, 2].map(() => new Animated.Value(0)),
    cta: new Animated.Value(0),
  }));
  useEffect(() => {
    const fade = (a: Animated.Value, duration = 420) => Animated.timing(a, { toValue: 1, duration, easing: ease, useNativeDriver: false });
    Animated.sequence([
      fade(v.intro, 520),
      Animated.delay(450),
      Animated.parallel([fade(v.shrink, 900), Animated.sequence([Animated.delay(350), fade(v.payout, 500)])]),
      Animated.stagger(140, v.points.map((p) => fade(p, 360))),
      fade(v.cta, 320),
    ]).start();
  }, [v]);
  return v;
}

const rise = (a: Animated.Value, px = 12) => ({ opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [px, 0] }) }] });

function StoryPair({ intro, shrink, payout }: { intro: Animated.Value; shrink: Animated.Value; payout: Animated.Value }) {
  const custody = shrink.interpolate({ inputRange: [0, 1], outputRange: ["100%", "60%"] });
  const short = shrink.interpolate({ inputRange: [0, 1], outputRange: ["50%", "30%"] });
  const before = shrink.interpolate({ inputRange: [0, 0.5], outputRange: [1, 0], extrapolate: "clamp" });
  const after = shrink.interpolate({ inputRange: [0.5, 1], outputRange: [0, 1], extrapolate: "clamp" });
  const sync = tone.sync;
  return (
    <Animated.View style={[w.card, rise(intro)]} accessibilityLabel="Example: 0.10 SOL with a 0.05 short becomes 0.06 SOL with a 0.03 short, and 0.04 SOL goes to your wallet">
      <View style={w.head}>
        <T v="label">Your SOL</T>
        <View>
          <Animated.Text style={[w.num, { opacity: before }]}>0.10 SOL</Animated.Text>
          <Animated.Text style={[w.num, w.over, { opacity: after }]}>0.06 SOL</Animated.Text>
        </View>
      </View>
      <View style={w.track}>
        <Animated.View style={[w.fill, { width: custody, backgroundColor: color.brand }]} />
      </View>
      <View style={w.bridge}>
        <View style={[w.bridgeLine, { backgroundColor: sync.fg }]} />
        <View style={[w.tag, { backgroundColor: sync.bg }]}>
          <Icon name="link" size={14} tint={sync.fg} />
          <T v="caption" style={{ color: sync.fg }}>Linked · 50% hedged</T>
        </View>
      </View>
      <View style={w.head}>
        <T v="label">Its hedge</T>
        <View>
          <Animated.Text style={[w.num, { opacity: before }]}>0.05 SOL</Animated.Text>
          <Animated.Text style={[w.num, w.over, { opacity: after }]}>0.03 SOL</Animated.Text>
        </View>
      </View>
      <View style={w.track}>
        <Animated.View style={[w.fill, { width: short, backgroundColor: color.hedge }]} />
      </View>
      <Animated.View style={[w.payout, rise(payout, 8)]}>
        <Icon name="wallet" size={16} tint={color.brand} />
        <T v="label" style={{ color: color.brand }}>+0.04 SOL to your wallet, in one step</T>
      </Animated.View>
    </Animated.View>
  );
}

const POINTS: { icon: IconName; title: string; body: string }[] = [
  { icon: "rule", title: "Set one rule", body: "“If SOL hits $210, take out 0.04 SOL.” Used once, cancel any time." },
  { icon: "clock", title: "It runs while your phone is off", body: "A keeper carries it out. It can only shrink your position." },
  { icon: "shield", title: "Your SOL only comes back to you", body: "No one else can receive it, and you can withdraw everything yourself." },
];

export default function Welcome() {
  const { owner, connectWallet, connecting, connectError } = useNelta();
  const story = useStory();
  if (owner) return <Redirect href="/home" />;
  return (
    <SafeAreaView style={w.root}>
      <ScrollView contentContainerStyle={w.page} showsVerticalScrollIndicator={false}>
      <View style={w.top}>
        <Mark size={32} />
        <Pill tone="waiting" label="Devnet · test funds" />
      </View>
      <View style={w.body}>
        <Animated.View style={rise(story.intro)}>
          <T v="hero">Your SOL and its hedge, always together.</T>
        </Animated.View>
        <StoryPair intro={story.intro} shrink={story.shrink} payout={story.payout} />
        <View style={{ gap: space.md }}>
          {POINTS.map((p, i) => (
            <Animated.View key={p.title} style={[w.point, rise(story.points[i], 8)]}>
              <View style={w.icon}>
                <Icon name={p.icon} size={18} tint={color.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <T v="h2" style={{ fontSize: 16, lineHeight: 22 }}>{p.title}</T>
                <T v="caption">{p.body}</T>
              </View>
            </Animated.View>
          ))}
        </View>
      </View>
      <Animated.View style={rise(story.cta, 8)}>
        {connectError && <Notice tone={connectError.tone} title={connectError.title} body={connectError.body} />}
        <Button label={connecting ? "Waiting for your wallet…" : "Connect wallet"} icon="wallet" loading={connecting} onPress={() => void connectWallet()} />
        <T v="caption" style={{ textAlign: "center", marginTop: space.md }}>Using Phantom? Turn on Settings → Developer settings → Testnet mode → Solana Devnet first, and turn off Power saving.</T>
      </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const w = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  page: { flexGrow: 1, paddingHorizontal: space.xl, paddingVertical: space.lg, justifyContent: "space-between", gap: space.xl },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  body: { gap: space.xl },
  card: { backgroundColor: color.surface, borderColor: color.border, borderWidth: 1, borderRadius: radius.card, padding: space.lg },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: space.sm },
  num: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: color.text, fontVariant: ["tabular-nums"], textAlign: "right" },
  over: { position: "absolute", right: 0 },
  track: { height: 12, borderRadius: 6, backgroundColor: color.surfaceMuted, overflow: "hidden" },
  fill: { height: 12, borderRadius: 6 },
  bridge: { flexDirection: "row", alignItems: "center", gap: space.sm, marginVertical: space.sm, marginLeft: space.lg },
  bridgeLine: { width: 2, height: 22, opacity: 0.5 },
  tag: { flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill },
  payout: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.lg, backgroundColor: color.brandSoft, borderRadius: radius.control, padding: space.sm },
  point: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: color.brandSoft, alignItems: "center", justifyContent: "center" },
});
