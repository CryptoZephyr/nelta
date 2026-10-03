import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControlProps,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextProps,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Icon, IconName } from "./icons";
import { color, font, radius, space, tone as tones, Tone, touch } from "./theme";

type Variant = "hero" | "h1" | "h2" | "body" | "label" | "caption" | "mono" | "num";

const variants: Record<Variant, TextStyle> = {
  hero: { fontFamily: font.display, fontSize: 44, lineHeight: 48, color: color.text },
  h1: { fontFamily: font.display, fontSize: 30, lineHeight: 36, color: color.text },
  h2: { fontFamily: font.semibold, fontSize: 18, lineHeight: 26, color: color.text },
  body: { fontFamily: font.regular, fontSize: 16, lineHeight: 24, color: color.text },
  label: { fontFamily: font.medium, fontSize: 14, lineHeight: 20, color: color.textMuted },
  caption: { fontFamily: font.regular, fontSize: 13, lineHeight: 18, color: color.textMuted },
  mono: { fontFamily: font.mono, fontSize: 13, lineHeight: 18, color: color.textMuted },
  num: { fontFamily: font.semibold, fontSize: 16, lineHeight: 24, color: color.text, fontVariant: ["tabular-nums"] },
};

export function T({ v = "body", style, ...rest }: TextProps & { v?: Variant }) {
  return <Text {...rest} style={[variants[v], style]} />;
}

export function Screen({ children, footer, refresh }: { children: React.ReactNode; footer?: React.ReactNode; refresh?: React.ReactElement<RefreshControlProps> }) {
  return (
    <SafeAreaView style={s.root} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={s.scroll} refreshControl={refresh} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {footer && <View style={s.footer}>{footer}</View>}
    </SafeAreaView>
  );
}

export function Card({ children, style, tint }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; tint?: string }) {
  return <View style={[s.card, tint ? { backgroundColor: tint, borderColor: tint } : null, style]}>{children}</View>;
}

export function Pill({ tone, label, icon }: { tone: Tone; label: string; icon?: IconName }) {
  const t = tones[tone];
  return (
    <View style={[s.pill, { backgroundColor: t.bg }]}>
      {icon && <Icon name={icon} size={14} tint={t.fg} />}
      <Text style={[s.pillText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

export function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.row}>
      <T v="label">{label}</T>
      <T v="num" style={strong ? null : { fontFamily: font.medium }}>{value}</T>
    </View>
  );
}

type ButtonKind = "primary" | "secondary" | "danger" | "quiet";

export function Button({ label, onPress, disabled, kind = "primary", loading, icon }: { label: string; onPress: () => void; disabled?: boolean; kind?: ButtonKind; loading?: boolean; icon?: IconName }) {
  const fg = kind === "primary" ? color.onBrand : kind === "danger" ? tones.failed.fg : color.brand;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [s.btn, s[kind], disabled && s.disabled, pressed && { opacity: 0.85 }]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon && <Icon name={icon} size={18} tint={fg} />}
      <Text style={[s.btnText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, value, onChange, unit, hint, error, placeholder }: { label: string; value: string; onChange: (v: string) => void; unit?: string; hint?: string; error?: string | null; placeholder?: string }) {
  return (
    <View style={{ marginTop: space.lg }}>
      <T v="label">{label}</T>
      <View style={[s.input, error ? { borderColor: tones.failed.fg } : null]}>
        <TextInput
          style={s.inputText}
          value={value}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          placeholder={placeholder}
          placeholderTextColor={color.textMuted}
          accessibilityLabel={label}
        />
        {unit && <T v="label">{unit}</T>}
      </View>
      {error ? <T v="caption" style={{ color: tones.failed.fg, marginTop: space.xs }}>{error}</T> : hint ? <T v="caption" style={{ marginTop: space.xs }}>{hint}</T> : null}
    </View>
  );
}

export function Segmented<V extends string | number | boolean>({ options, value, onChange }: { options: { value: V; label: string }[]; value: V; onChange: (v: V) => void }) {
  return (
    <View style={s.seg}>
      {options.map((o) => (
        <Pressable key={String(o.value)} onPress={() => onChange(o.value)} style={[s.segBtn, o.value === value && s.segOn]} accessibilityRole="button" accessibilityState={{ selected: o.value === value }}>
          <Text style={[s.segText, o.value === value && { color: color.brand }]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Bar({ fraction, fill, notch }: { fraction: number; fill: string; notch?: number }) {
  const [w] = useState(() => new Animated.Value(fraction));
  useEffect(() => {
    Animated.timing(w, { toValue: fraction, duration: 200, useNativeDriver: false }).start();
  }, [fraction, w]);
  return (
    <View style={s.track}>
      <Animated.View style={[s.fill, { backgroundColor: fill, width: w.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]} />
      {notch !== undefined && <View style={[s.notch, { left: `${Math.min(99.5, notch * 100)}%` }]} />}
    </View>
  );
}

/** The Pair: SOL in custody above, the short below, with a notch at the target short. */
export function Pair({ custody, shortNow, target, inSync, ratioPct }: { custody: number; shortNow: number; target: number; inSync: boolean; ratioPct: number }) {
  const max = Math.max(custody, shortNow, target, 1e-9);
  const off = Math.abs(shortNow - target);
  const t = inSync ? tones.sync : tones.drift;
  return (
    <View accessibilityLabel={`SOL in custody ${custody.toFixed(4)}, short ${shortNow.toFixed(4)}, target ${target.toFixed(4)}`}>
      <View style={s.pairHead}>
        <T v="label">SOL in custody</T>
        <T v="num">{custody.toFixed(4)} SOL</T>
      </View>
      <Bar fraction={custody / max} fill={color.brand} />
      <View style={s.bridge}>
        <View style={[s.bridgeLine, { backgroundColor: t.fg }]} />
        <View style={[s.bridgeTag, { backgroundColor: t.bg }]}>
          <Icon name={inSync ? "link" : "unlink"} size={14} tint={t.fg} />
          <Text style={[s.pillText, { color: t.fg }]}>{inSync ? `Linked · ${ratioPct}% hedged` : `Off by ${off.toFixed(4)} SOL`}</Text>
        </View>
      </View>
      <View style={s.pairHead}>
        <T v="label">SOL-PERP short</T>
        <T v="num">{shortNow.toFixed(4)} SOL</T>
      </View>
      <Bar fraction={shortNow / max} fill={color.hedge} notch={target / max} />
      <T v="caption" style={{ marginTop: space.xs }}>Target short {target.toFixed(4)} SOL</T>
    </View>
  );
}

export function Notice({ tone, title, body, icon }: { tone: Tone; title: string; body?: string; icon?: IconName }) {
  const t = tones[tone];
  return (
    <View style={[s.notice, { backgroundColor: t.bg }]}>
      {icon && <Icon name={icon} size={18} tint={t.fg} />}
      <View style={{ flex: 1 }}>
        <Text style={[s.noticeTitle, { color: t.fg }]}>{title}</Text>
        {body && <T v="caption" style={{ color: t.fg }}>{body}</T>}
      </View>
    </View>
  );
}

export const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  scroll: { padding: space.lg, paddingBottom: space.huge },
  footer: { padding: space.lg, paddingTop: space.md, borderTopWidth: 1, borderColor: color.border, backgroundColor: color.bg, gap: space.sm },
  card: { backgroundColor: color.surface, borderRadius: radius.card, padding: space.lg, marginTop: space.lg, borderWidth: 1, borderColor: color.border },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontFamily: font.semibold, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 32 },
  btn: { minHeight: touch, borderRadius: radius.control, flexDirection: "row", gap: space.sm, alignItems: "center", justifyContent: "center", paddingHorizontal: space.lg, marginTop: space.md },
  primary: { backgroundColor: color.brand },
  secondary: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.border },
  danger: { backgroundColor: tones.failed.bg },
  quiet: { backgroundColor: "transparent" },
  disabled: { opacity: 0.4 },
  btnText: { fontFamily: font.semibold, fontSize: 16 },
  input: { flexDirection: "row", alignItems: "center", minHeight: touch, backgroundColor: color.surfaceMuted, borderRadius: radius.control, paddingHorizontal: space.md, marginTop: space.xs, borderWidth: 1, borderColor: color.surfaceMuted },
  inputText: { flex: 1, fontFamily: font.medium, fontSize: 18, color: color.text, paddingVertical: space.sm, fontVariant: ["tabular-nums"] },
  seg: { flexDirection: "row", backgroundColor: color.surfaceMuted, borderRadius: radius.control, padding: 3, marginTop: space.sm },
  segBtn: { flex: 1, minHeight: 42, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.border },
  segText: { fontFamily: font.medium, fontSize: 15, color: color.textMuted },
  track: { height: 12, borderRadius: 6, backgroundColor: color.surfaceMuted, marginTop: space.sm, overflow: "hidden" },
  fill: { height: 12, borderRadius: 6 },
  notch: { position: "absolute", top: -2, width: 3, height: 16, borderRadius: 1.5, backgroundColor: color.text },
  pairHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  bridge: { height: 40, justifyContent: "center", paddingLeft: space.md },
  bridgeLine: { position: "absolute", left: 18, top: 0, bottom: 0, width: 2, opacity: 0.35 },
  bridgeTag: { flexDirection: "row", gap: 6, alignItems: "center", alignSelf: "flex-start", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, marginLeft: space.xl },
  notice: { flexDirection: "row", gap: space.md, padding: space.md, borderRadius: radius.control, marginTop: space.md, alignItems: "flex-start" },
  noticeTitle: { fontFamily: font.semibold, fontSize: 15, lineHeight: 22 },
});
