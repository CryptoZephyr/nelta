import { BN } from "@anchor-lang/core";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { LAMPORTS, Nelta, RPC, Snapshot, SOL_ORACLE } from "./src/nelta";
import { connect, disconnect, signAndSend, signBatch } from "./src/wallet";

const connection = new Connection(RPC, "confirmed");
const BATCH = 12;
const sol = (lamports: bigint | number) => (Number(lamports) / LAMPORTS).toFixed(4);
const nextOracleUpdate = () =>
  new Promise<void>((resolve) => {
    const id = connection.onAccountChange(SOL_ORACLE, () => { void connection.removeAccountChangeListener(id); resolve(); }, { commitment: "processed" });
    setTimeout(resolve, 8_000);
  });

/** Submits pre-signed variants one per oracle update until one confirms; failed fills revert whole. */
async function submitUntilFilled(txs: Transaction[], onAttempt: (n: number) => void): Promise<string> {
  let last = "no attempts";
  for (let i = 0; i < txs.length; i++) {
    onAttempt(i + 1);
    await nextOracleUpdate();
    try {
      const sig = await connection.sendRawTransaction(txs[i].serialize(), { skipPreflight: false });
      const res = await connection.confirmTransaction(sig, "confirmed");
      if (!res.value.err) return sig;
      last = JSON.stringify(res.value.err);
    } catch (e) {
      last = String((e as Error).message ?? e).slice(0, 120);
      if (!/0x1891|SuccessCondition|blockhash/i.test(last)) throw new Error(last);
    }
  }
  throw new Error(`No fill after ${txs.length} attempts (${last}). Nothing changed; try again.`);
}

export default function App() {
  const [owner, setOwner] = useState<PublicKey | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState("");
  const [above, setAbove] = useState(true);
  const [releaseAmt, setReleaseAmt] = useState("0.04");
  const [hours, setHours] = useState("24");
  const [depositAmt, setDepositAmt] = useState("0.1001");
  const [ratio, setRatio] = useState("50");
  const nelta = useMemo(() => (owner ? new Nelta(connection, owner) : null), [owner]);

  const refresh = useCallback(async () => {
    if (!nelta) return;
    try {
      setSnap(await nelta.snapshot());
      setReadError(null);
    } catch (e) {
      setReadError(`Could not read chain: ${(e as Error).message}`);
    }
  }, [nelta]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setMessage(null);
    try {
      const sig = await fn();
      if (sig) setMessage(`${label}: confirmed ${sig.slice(0, 8)}…`);
    } catch (e) {
      setMessage(`${label} failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  const send = (label: string, ixs: (n: Nelta) => Promise<import("@solana/web3.js").TransactionInstruction[]>) =>
    run(label, async () => {
      const n = nelta!;
      const { blockhash } = await connection.getLatestBlockhash();
      const sig = await signAndSend(async () => n.tx(await ixs(n), blockhash));
      const res = await connection.confirmTransaction(sig, "confirmed");
      if (res.value.err) throw new Error(JSON.stringify(res.value.err));
      return sig;
    });

  const sendWithFill = (label: string, ixs: (n: Nelta) => Promise<import("@solana/web3.js").TransactionInstruction[]>) =>
    run(label, async () => {
      const n = nelta!;
      const { blockhash } = await connection.getLatestBlockhash();
      const built = await ixs(n);
      const signed = await signBatch(async () => Array.from({ length: BATCH }, (_, i) => n.tx(built, blockhash, i)));
      return submitUntilFilled(signed, (a) => setBusy(`${label}: waiting for a fill (${a}/${BATCH})`));
    });

  if (!owner) {
    return (
      <SafeAreaView style={s.root}>
        <StatusBar style="light" />
        <View style={s.hero}>
          <Text style={s.logo}>Nelta</Text>
          <Text style={s.tag}>Your SOL and its hedge move together, or not at all.</Text>
          <Text style={s.body}>
            Arm a one-use rule like “if SOL ≥ $X, release 0.04 SOL and shrink my short”. A keeper runs it while your phone is off. It can only reduce risk and only pays you.
          </Text>
          <Btn label="Connect wallet" onPress={() => run("Connect", async () => { setOwner(await connect()); return ""; })} />
          {message && <Text style={s.msg}>{message}</Text>}
          <Text style={s.foot}>Devnet · Mobile Wallet Adapter</Text>
        </View>
      </SafeAreaView>
    );
  }

  const pos = snap?.position;
  const inSync = snap ? snap.shortBase === snap.targetShort : false;
  const rule = pos?.rule;
  const ruleLive = rule?.active && rule.expiryTs.toNumber() > Date.now() / 1000;

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={s.scroll} refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refresh()} tintColor="#fff" />}>
        <View style={s.row}>
          <Text style={s.logoSm}>Nelta</Text>
          <Pressable onPress={() => { disconnect(); setOwner(null); setSnap(null); }}>
            <Text style={s.addr}>{owner.toBase58().slice(0, 4)}…{owner.toBase58().slice(-4)} · Devnet</Text>
          </Pressable>
        </View>

        {busy && (
          <View style={s.banner}><ActivityIndicator color="#0b0f14" /><Text style={s.bannerText}>{busy}</Text></View>
        )}
        {message && <Text style={s.msg}>{message}</Text>}
        {readError && <Text style={s.msg}>{readError}</Text>}

        {!snap ? (
          <ActivityIndicator color="#fff" style={{ marginTop: 40 }} />
        ) : !pos ? (
          <Card title="Create your Nelta position">
            <Text style={s.body}>Creates a vault controlled by the Nelta program. Only you can withdraw; the keeper can only execute rules you arm.</Text>
            <Field label="Hedge ratio (%)" value={ratio} onChange={setRatio} />
            <Btn label="Create position" disabled={!!busy} onPress={() => send("Create position", (n) => n.createPositionIxs(Math.round(Number(ratio) * 100)))} />
          </Card>
        ) : (
          <>
            <Card title="Position">
              <Stat label="SOL in custody" value={`${sol(snap.solLamports)} SOL`} />
              <Stat label="SOL-PERP short" value={`${sol(snap.shortBase)} SOL`} />
              <Stat label={`Target (${pos.ratioBps / 100}% hedge)`} value={`${sol(snap.targetShort)} SOL`} />
              <View style={[s.pill, inSync ? s.ok : s.warn]}>
                <Text style={s.pillText}>{inSync ? "Hedge in sync" : "Hedge out of sync"}</Text>
              </View>
              <Stat label="SOL price" value={`$${snap.price.toFixed(2)} · ${snap.oracleAgeSecs}s old`} />
              <Stat label="Released to you" value={`${snap.ownerWsol.toFixed(4)} wSOL`} />
              {!inSync && <Btn label="Sync hedge now" disabled={!!busy} onPress={() => sendWithFill("Sync hedge", (n) => n.rebalanceIxs())} />}
            </Card>

            <Card title="One-use rule">
              {ruleLive ? (
                <>
                  <Text style={s.ruleText}>
                    If SOL {rule!.above ? "≥" : "≤"} ${(rule!.triggerPrice.toNumber() / 1e6).toFixed(2)}, release {sol(rule!.releaseLamports.toNumber())} SOL and shrink the short to match.
                  </Text>
                  <Text style={s.dim}>Expires {new Date(rule!.expiryTs.toNumber() * 1000).toLocaleString()} · nonce {pos.ruleNonce.toString()}</Text>
                  <Text style={s.dim}>Runs once, even if this phone is off. Funds can only go to your wallet.</Text>
                  <Btn label="Revoke rule" kind="danger" disabled={!!busy} onPress={() => send("Revoke rule", (n) => n.revokeRuleIxs())} />
                </>
              ) : (
                <>
                  <View style={s.toggle}>
                    {[true, false].map((v) => (
                      <Pressable key={String(v)} onPress={() => setAbove(v)} style={[s.toggleBtn, above === v && s.toggleOn]}>
                        <Text style={s.toggleText}>{v ? "SOL rises to" : "SOL falls to"}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Field label="Trigger price (USD)" value={trigger} onChange={setTrigger} placeholder={snap.price.toFixed(2)} />
                  <Field label="Release (SOL)" value={releaseAmt} onChange={setReleaseAmt} />
                  <Field label="Expires in (hours)" value={hours} onChange={setHours} />
                  <Btn
                    label="Arm rule"
                    disabled={!!busy || !Number(trigger) || !Number(releaseAmt)}
                    onPress={() => send("Arm rule", (n) => n.setRuleIxs(Number(trigger), above, Number(releaseAmt), Math.floor(Date.now() / 1000 + Number(hours) * 3600)))}
                  />
                </>
              )}
            </Card>

            <Card title="Release now">
              <Text style={s.body}>Shrinks the short and releases SOL in one transaction. If the hedge can't be reduced, nothing moves.</Text>
              <Field label="Release (SOL)" value={releaseAmt} onChange={setReleaseAmt} />
              <Btn label="Release with hedge" disabled={!!busy || !Number(releaseAmt)} onPress={() => sendWithFill("Release", (n) => n.releaseIxs(BigInt(Math.round(Number(releaseAmt) * LAMPORTS))))} />
            </Card>

            <Card title="Add funds">
              <Stat label="Wallet" value={`${(snap.walletLamports / LAMPORTS).toFixed(3)} SOL · ${snap.walletDusdt.toFixed(2)} dUSDT`} />
              <Field label="Deposit SOL" value={depositAmt} onChange={setDepositAmt} />
              <Btn label="Deposit SOL" disabled={!!busy} onPress={() => send("Deposit SOL", (n) => n.depositSolIxs(Math.round(Number(depositAmt) * LAMPORTS)))} />
              {snap.walletDusdt > 0 && <Btn label={`Deposit ${snap.walletDusdt.toFixed(2)} dUSDT collateral`} kind="ghost" disabled={!!busy} onPress={() => send("Deposit dUSDT", (n) => n.depositDusdtIxs(snap.walletDusdt))} />}
            </Card>

            <Card title="Recovery">
              <Text style={s.body}>Works without Nelta's servers. Step 1 places a reduce-only order that Velocity keepers fill; step 2 withdraws everything.</Text>
              <Btn label="1 · Close hedge" kind="ghost" disabled={!!busy || snap.shortBase === 0n} onPress={() => send("Close hedge", async (n) => [...(await n.setRatioIxs(0)), ...(await n.reduceHedgeIxs(snap.shortBase))])} />
              <Btn
                label="2 · Withdraw all SOL"
                kind="ghost"
                disabled={!!busy || snap.shortBase !== 0n || snap.solLamports === 0n}
                onPress={() => send("Withdraw SOL", (n) => n.releaseIxs(snap.solLamports))}
              />
              <Btn label="Withdraw collateral (1 dUSDT)" kind="ghost" disabled={!!busy} onPress={() => send("Withdraw collateral", (n) => n.withdrawCollateralIxs(new BN(1_000_000)))} />
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={s.card}><Text style={s.cardTitle}>{title}</Text>{children}</View>;
}
function Stat({ label, value }: { label: string; value: string }) {
  return <View style={s.stat}><Text style={s.dim}>{label}</Text><Text style={s.val}>{value}</Text></View>;
}
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={s.dim}>{label}</Text>
      <TextInput style={s.input} value={value} onChangeText={onChange} keyboardType="decimal-pad" placeholder={placeholder} placeholderTextColor="#5b6675" />
    </View>
  );
}
function Btn({ label, onPress, disabled, kind = "primary" }: { label: string; onPress: () => void; disabled?: boolean; kind?: "primary" | "ghost" | "danger" }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[s.btn, kind === "ghost" && s.btnGhost, kind === "danger" && s.btnDanger, disabled && { opacity: 0.4 }]}>
      <Text style={[s.btnText, kind !== "primary" && { color: "#e8edf3" }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b0f14" },
  scroll: { padding: 18, paddingTop: 48, paddingBottom: 60 },
  hero: { flex: 1, justifyContent: "center", padding: 28 },
  logo: { color: "#7cf5c4", fontSize: 44, fontWeight: "800" },
  logoSm: { color: "#7cf5c4", fontSize: 26, fontWeight: "800" },
  tag: { color: "#e8edf3", fontSize: 20, fontWeight: "600", marginTop: 8 },
  body: { color: "#9aa6b5", fontSize: 14, lineHeight: 20, marginTop: 8 },
  foot: { color: "#5b6675", marginTop: 24, fontSize: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  addr: { color: "#9aa6b5", fontSize: 13 },
  card: { backgroundColor: "#121922", borderRadius: 16, padding: 16, marginTop: 14, borderWidth: 1, borderColor: "#1d2733" },
  cardTitle: { color: "#e8edf3", fontSize: 17, fontWeight: "700", marginBottom: 6 },
  stat: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  dim: { color: "#7d8896", fontSize: 13, marginTop: 4 },
  val: { color: "#e8edf3", fontSize: 15, fontWeight: "600" },
  pill: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginTop: 12 },
  ok: { backgroundColor: "#1f5e47" },
  warn: { backgroundColor: "#6b4b12" },
  pillText: { color: "#e8edf3", fontWeight: "700", fontSize: 12 },
  ruleText: { color: "#e8edf3", fontSize: 15, lineHeight: 22 },
  input: { backgroundColor: "#0b0f14", color: "#e8edf3", borderRadius: 10, padding: 12, marginTop: 4, borderWidth: 1, borderColor: "#1d2733", fontSize: 16 },
  btn: { backgroundColor: "#7cf5c4", borderRadius: 12, padding: 14, alignItems: "center", marginTop: 14 },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#2b3846" },
  btnDanger: { backgroundColor: "#5c1f24" },
  btnText: { color: "#0b0f14", fontWeight: "700", fontSize: 15 },
  toggle: { flexDirection: "row", gap: 8, marginTop: 6 },
  toggleBtn: { flex: 1, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: "#2b3846", alignItems: "center" },
  toggleOn: { backgroundColor: "#1d2733", borderColor: "#7cf5c4" },
  toggleText: { color: "#e8edf3", fontWeight: "600" },
  banner: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: "#7cf5c4", padding: 12, borderRadius: 12, marginTop: 6 },
  bannerText: { color: "#0b0f14", fontWeight: "600", flexShrink: 1 },
  msg: { color: "#e8edf3", backgroundColor: "#1d2733", padding: 12, borderRadius: 12, marginTop: 10, fontSize: 13 },
});
