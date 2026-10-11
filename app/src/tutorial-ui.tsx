import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Linking, View } from "react-native";
import { explorerTx, sol } from "./format";
import { Icon } from "./icons";
import { targetShort } from "./nelta";
import { useNow } from "./now";
import { useNelta } from "./store";
import { color, space, tone } from "./theme";
import {
  changePreferences, DEVNET_CHAIN, emptyPreferences, PreferenceAction,
  TutorialPreferencesStore, tutorialProgress, tutorialScope,
} from "./tutorial";
import { Button, Card, Notice, T } from "./ui";

const preferencesStore = new TutorialPreferencesStore(AsyncStorage);

function useTutorialState() {
  const { owner, snap, reading, readError, lastAttempt } = useNelta();
  const now = useNow(1_000) * 1_000 + 999;
  const [prefs, setPrefs] = useState(emptyPreferences);
  const prefsRef = useRef(prefs);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const scope = tutorialScope(owner?.toBase58() ?? null, DEVNET_CHAIN);
  const progress = tutorialProgress({ owner: owner?.toBase58() ?? null, network: DEVNET_CHAIN, snap, reading, readError, attempt: lastAttempt, now });

  useEffect(() => {
    let current = true;
    void preferencesStore.load().then((loaded) => {
      if (!current) return;
      prefsRef.current = loaded;
      setPrefs(loaded);
    }).catch(() => {
      if (current) setStorageError("Couldn’t read tutorial preferences. You can still use Nelta; try saving them again from Help.");
    }).finally(() => {
      if (current) setReady(true);
    });
    return () => { current = false; };
  }, []);

  const change = async (action: PreferenceAction) => {
    if (!ready || (action === "complete" && !progress.complete)) return;
    const next = changePreferences(prefsRef.current, scope, action);
    prefsRef.current = next;
    setPrefs(next);
    try {
      await preferencesStore.save(next);
      setStorageError(null);
    } catch {
      setStorageError("Couldn’t save tutorial preferences on this device. Your choice applies for this session; try saving again.");
    }
  };
  const retrySave = async () => {
    try {
      await preferencesStore.save(prefsRef.current);
      setStorageError(null);
    } catch {
      setStorageError("Couldn’t save tutorial preferences. Your funds and position aren’t affected.");
    }
  };
  return { ready, prefs, scope, progress, change, retrySave, storageError };
}

const TutorialContext = createContext<ReturnType<typeof useTutorialState> | null>(null);

export function TutorialProvider({ children }: { children: React.ReactNode }) {
  const value = useTutorialState();
  return <TutorialContext.Provider value={value}>{children}</TutorialContext.Provider>;
}

export function useTutorial() {
  const value = useContext(TutorialContext);
  if (!value) throw new Error("useTutorial outside TutorialProvider");
  return value;
}

export function TutorialCard({ screen }: { screen: "welcome" | "home" | "funds" }) {
  const { ready, prefs, scope, progress, change, storageError } = useTutorial();
  const { snap, lastAttempt, refresh } = useNelta();
  const router = useRouter();
  if (!ready || prefs.skipped || prefs.scopes[scope]?.complete) return null;
  const bodies = [
    "Solana Devnet · test funds only. Connect your wallet, then create a position. Nelta manages only the assets you deposit into that position.",
    "Test dUSDT collateral supports the short trade. Get it below or on Add funds. This is separate from depositing SOL.",
    "Add only the SOL you want Nelta to manage. The deposit funds your position; it doesn’t open a hedge. It stays unhedged until the short fills.",
    "Choose how much of your SOL to hedge. A short can gain when SOL falls, helping cushion the loss. Fees, funding and liquidation risk still apply.",
    "Check your percentage below, then use Sync hedge. Setup finishes only after confirmation and a fresh reading show the short matches the rounded target.",
  ];
  const heading = progress.complete ? "Your hedge is active" : progress.paused ? "Setup is waiting" : `Step ${progress.next + 1} of 5 · ${progress.steps[progress.next].label}`;
  return (
    <Card tint={color.brandSoft}>
      <T v="label">First-time guide</T>
      <T v="h2" style={{ marginTop: space.xs }}>{heading}</T>
      <T v="body" style={{ marginTop: space.sm }}>
        {progress.complete
          ? `The confirmed reading shows a ${sol(snap!.shortBase)} SOL short matching your ${snap!.position!.ratioBps / 100}% target. Fees and risks still apply. No extra deposit or trade is needed.`
          : progress.paused ? progress.body : bodies[progress.next]}
      </T>
      {!progress.paused && progress.body && <Notice tone="waiting" title={lastAttempt?.phase.kind === "failed" ? "Changes not applied" : "Before you sync"} body={progress.body} />}
      {screen === "home" && !progress.complete && !progress.paused && (
        <View style={{ marginTop: space.md, gap: space.sm }}>
          {progress.steps.map((step, index) => (
            <View key={step.label} style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
              <Icon name={step.done ? "check" : index === progress.next ? "arrow" : "clock"} size={16} tint={step.done ? tone.sync.fg : color.textMuted} />
              <T v="caption" style={{ flex: 1 }}>{step.label}</T>
            </View>
          ))}
        </View>
      )}
      {progress.paused && lastAttempt?.phase.kind === "failed" && !lastAttempt.phase.nothingChanged ? (
        <>
          {lastAttempt.sig && <Button label="View receipt in Explorer" kind="secondary" onPress={() => void Linking.openURL(explorerTx(lastAttempt.sig!))} />}
          <Button label="Check Activity before retrying" kind="secondary" onPress={() => router.push("/activity")} />
          <Button label="Refresh position and receipt" kind="quiet" onPress={() => void refresh()} />
        </>
      ) : progress.paused && screen !== "welcome" ? (
        <Button label="Refresh position" kind="secondary" onPress={() => void refresh()} />
      ) : null}
      {progress.complete && <Button label="Finish tutorial" onPress={() => void change("complete")} />}
      {storageError && <T v="caption" style={{ marginTop: space.sm }}>{storageError}</T>}
      <Button label="Skip tutorial" kind="quiet" onPress={() => void change("skip")} />
      <T v="caption">Restart anytime from Help. Every action still needs your wallet approval.</T>
    </Card>
  );
}

export function HedgeTutorial({ ratioPct }: { ratioPct: number }) {
  const { ready, prefs, scope } = useTutorial();
  const { snap } = useNelta();
  if (!ready || prefs.skipped || prefs.scopes[scope]?.complete || !snap?.position || snap.solLamports === 0n) return null;
  const target = snap.step > 0n ? targetShort(snap.solLamports, ratioPct * 100, snap.step) : 0n;
  return (
    <Notice
      tone="waiting"
      title="4 · Choose your hedge percentage"
      body={`${ratioPct}% of your ${sol(snap.solLamports)} SOL aims for a ${sol(target)} SOL short after rounding. A short can gain when SOL falls, helping cushion the loss. Fees, funding and liquidation risk remain. Changing the selection alone doesn’t change the short.`}
    />
  );
}

export function FeatureTutorial({ feature }: { feature: "release" | "rule" }) {
  const { ready, prefs, scope, change } = useTutorial();
  const { snap } = useNelta();
  const seen = feature === "release" ? "releaseSeen" : "ruleSeen";
  if (!ready || prefs.skipped || prefs.scopes[scope]?.[seen] || !snap?.position) return null;
  return (
    <Card tint={color.brandSoft}>
      <T v="h2">{feature === "release" ? "Release SOL and reduce its short together" : "Approve a one-use price rule"}</T>
      <T v="body" style={{ marginTop: space.sm }}>
        {feature === "release"
          ? "When you release SOL, Nelta reduces the linked short in the same transaction. The SOL goes only to your wallet. If a required step fails, both changes roll back."
          : "Choose a price, release amount and expiry, then approve in your wallet. The keeper can execute once while the app is closed, but only if the conditions, fresh price and trade fill allow it. Execution can be delayed or fail."}
      </T>
      <Button label="Got it" kind="secondary" onPress={() => void change(seen)} />
    </Card>
  );
}
