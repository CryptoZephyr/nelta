import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { explorerTx, short } from "./format";
import { Icon } from "./icons";
import { Change, Phase, useNelta } from "./store";
import { color, font, radius, space, tone } from "./theme";
import { Button, Notice, T } from "./ui";

function ChangeRow({ c }: { c: Change }) {
  return (
    <View style={st.change}>
      <T v="label" style={{ flex: 1 }}>{c.label}</T>
      <View style={st.vals}>
        {c.from && <T v="num" style={{ color: color.textMuted, fontFamily: font.regular }}>{c.from}</T>}
        {c.from && <Icon name="arrow" size={16} tint={color.textMuted} />}
        <T v="num">{c.to}</T>
      </View>
    </View>
  );
}

const LOW_FEE_LAMPORTS = 10_000_000;
const MIN_FEE_LAMPORTS = 10_000;

const STEPS = ["Waiting for Velocity", "Approve in wallet", "Waiting for a fill", "Confirmed on Devnet"];

function stepIndex(p: Phase, fill?: boolean): number {
  const offset = fill ? 1 : 0;
  if (p.kind === "venue") return 0;
  if (p.kind === "wallet") return offset;
  if (p.kind === "filling" || p.kind === "confirming") return offset + 1;
  return offset + 2;
}

function Progress({ phase, fill }: { phase: Phase; fill?: boolean }) {
  const steps = fill ? STEPS : [STEPS[1], "Confirming", STEPS[3]];
  const at = stepIndex(phase, fill);
  return (
    <View style={{ marginTop: space.lg, gap: space.md }}>
      {steps.map((label, i) => (
        <View key={label} style={st.step}>
          <View style={[st.dot, i < at && { backgroundColor: tone.sync.fg, borderColor: tone.sync.fg }, i === at && { borderColor: color.brand }]}>
            {i < at ? <Icon name="check" size={14} tint="#fff" /> : i === at ? <ActivityIndicator size="small" color={color.brand} /> : null}
          </View>
          <T v={i === at ? "h2" : "body"} style={i > at ? { color: color.textMuted } : null}>{label}</T>
        </View>
      ))}
      {phase.kind === "venue" && (
        <Notice
          tone="waiting"
          icon="clock"
          title="Waiting for Velocity"
          body="Velocity’s test market can’t take this order right now. Nelta checks after every price update and opens your wallet only once it can fill. You don’t need to do anything; this can take a minute or two."
        />
      )}
      {phase.kind === "wallet" && <T v="caption">{phase.why}</T>}
      {phase.kind === "filling" && (
        <Notice
          tone="waiting"
          icon="clock"
          title={`Try ${phase.attempt} of ${phase.max}`}
          body="Velocity fills only while its price feed is fresh. Each try either fills fully or changes nothing, so it’s safe to wait here."
        />
      )}
      {phase.kind === "confirming" && phase.sig && <T v="mono">{short(phase.sig, 8)}</T>}
    </View>
  );
}

export function FlowSheet() {
  const { flow, approve, dismiss, snap } = useNelta();
  const insets = useSafeAreaInsets();
  if (!flow) return null;
  const { plan, phase } = flow;
  const busy = phase.kind === "venue" || phase.kind === "wallet" || phase.kind === "confirming" || phase.kind === "filling";
  const lowFee = snap !== null && snap.walletLamports < LOW_FEE_LAMPORTS;
  const noFee = snap !== null && snap.walletLamports < MIN_FEE_LAMPORTS;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={dismiss} statusBarTranslucent>
      <Pressable style={st.scrim} onPress={busy ? undefined : dismiss} accessibilityLabel="Close" />
      <View style={[st.sheet, { paddingBottom: insets.bottom + space.lg }]}>
        <View style={st.grab} />
        <ScrollView>
          <T v="h1">{phase.kind === "done" ? "Done" : phase.kind === "failed" ? phase.title : plan.title}</T>
          {phase.kind === "preview" && (
            <>
              <T v="body" style={{ marginTop: space.sm, color: color.textMuted }}>{plan.summary}</T>
              <View style={st.box}>
                {plan.changes.map((c) => <ChangeRow key={c.label} c={c} />)}
              </View>
              {plan.notes?.map((n) => (
                <View key={n} style={st.noteRow}>
                  <Icon name="shield" size={16} tint={tone.sync.fg} />
                  <T v="caption" style={{ flex: 1, color: color.text }}>{n}</T>
                </View>
              ))}
              {lowFee && (
                <Notice
                  tone="drift"
                  title={noFee ? "Your wallet needs Devnet SOL first" : "Your wallet is low on Devnet SOL"}
                  body="Keep about 0.01 SOL for network fees; creating accounts costs a little more. Get free Devnet SOL at faucet.solana.com."
                />
              )}
            </>
          )}
          {busy && <Progress phase={phase} fill={plan.fill} />}
          {phase.kind === "done" && (
            <>
              <Notice tone="sync" icon="check" title="Confirmed on Devnet" body={plan.title} />
              <Pressable onPress={() => void Linking.openURL(explorerTx(phase.sig))} style={st.link} accessibilityRole="link">
                <T v="mono" style={{ color: color.brand }}>View {short(phase.sig, 8)} in Explorer</T>
              </Pressable>
            </>
          )}
          {phase.kind === "failed" && (
            <>
              <Notice tone={phase.nothingChanged ? "waiting" : "failed"} title={phase.nothingChanged ? "Nothing changed" : "Check before retrying"} body={phase.body} />
            </>
          )}
        </ScrollView>
        {phase.kind === "preview" && (
          <>
            {noFee ? (
              <Button label="Get Devnet SOL" icon="wallet" onPress={() => void Linking.openURL("https://faucet.solana.com")} />
            ) : (
              <Button label="Approve in wallet" icon="wallet" onPress={() => void approve()} />
            )}
            <Button label="Not now" kind="quiet" onPress={dismiss} />
          </>
        )}
        {phase.kind === "failed" && phase.nothingChanged && <Button label="Try again" onPress={() => void approve()} />}
        {(phase.kind === "done" || phase.kind === "failed") && <Button label="Close" kind={phase.kind === "done" ? "primary" : "secondary"} onPress={dismiss} />}
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(20,22,28,0.35)" },
  sheet: { backgroundColor: color.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: space.xl, paddingTop: space.md, maxHeight: "88%", elevation: 12, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 16 },
  grab: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: color.border, marginBottom: space.lg },
  box: { backgroundColor: color.bg, borderRadius: radius.control, padding: space.md, marginTop: space.lg, gap: space.sm },
  change: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 32 },
  vals: { flexDirection: "row", alignItems: "center", gap: 6 },
  noteRow: { flexDirection: "row", gap: space.sm, marginTop: space.md, alignItems: "flex-start" },
  step: { flexDirection: "row", alignItems: "center", gap: space.md },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: color.border, alignItems: "center", justifyContent: "center" },
  link: { minHeight: 44, justifyContent: "center", marginTop: space.sm },
});
