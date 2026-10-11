import type { Snapshot } from "./nelta";
import { targetShort } from "./nelta";
import type { Phase } from "./store";

export const DEVNET_CHAIN = "solana:devnet";
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const TUTORIAL_KEY = "nelta.tutorial.v1";

export interface PositionReading {
  owner: string;
  network: string;
  at: number;
}

export interface TutorialAttempt {
  owner: string;
  phase: Phase;
  at: number;
  fill: boolean;
  sig?: string;
}

export interface TutorialInput {
  owner: string | null;
  network: string;
  snap: Snapshot | null;
  reading: PositionReading | null;
  readError: string | null;
  attempt: TutorialAttempt | null;
  now: number;
}

export const STEP_LABELS = [
  "Connect wallet and create position",
  "Get test dUSDT collateral",
  "Add SOL",
  "Choose hedge percentage",
  "Sync hedge",
] as const;

export function tutorialScope(owner: string | null, network: string): string {
  return `${network}:${owner ?? "welcome"}`;
}

export function acceptsDevnet(chains?: readonly string[]): boolean {
  return chains === undefined || chains.includes(DEVNET_CHAIN);
}

export function tutorialProgress(input: TutorialInput) {
  const { owner, network, snap, reading, readError, now } = input;
  const attempt = input.attempt?.owner === owner ? input.attempt : null;
  const phase = attempt?.phase;
  const empty = STEP_LABELS.map((label) => ({ label, done: false }));
  const paused = (body: string) => ({ steps: empty, next: 0, complete: false, paused: true, body });
  if (network !== DEVNET_CHAIN) return paused("Switch your wallet and connection to Solana Devnet. This build uses test funds.");
  if (!owner) return { steps: empty, next: 0, complete: false, paused: false, body: "" };
  if (!snap || !reading || reading.owner !== owner || reading.network !== network ||
      (snap.position && snap.position.owner.toBase58() !== owner))
    return paused("Reading this wallet’s position from Devnet. Setup hasn’t advanced.");
  if (readError || now < reading.at || now - reading.at > 30_000 ||
      snap.oracleAgeSecs > 30 || snap.oracleAgeSecs < -5)
    return paused("Showing the last reading. Refresh Devnet before continuing; this doesn’t confirm a hedge.");
  if (phase && phase.kind !== "failed" && phase.kind !== "done" && phase.kind !== "preview")
    return paused("Finish the current wallet action and wait for confirmation. Approval alone doesn’t complete setup.");
  if (phase?.kind === "failed" && !phase.nothingChanged)
    return paused("Check before retrying: review the receipt in Activity, then refresh. The transaction may still land.");
  if (phase?.kind === "done" && reading.at < attempt!.at)
    return paused("Confirmed on Devnet. Reading the position again to check what actually changed.");

  const position = snap.position;
  const target = position && snap.step > 0n ? targetShort(snap.solLamports, position.ratioBps, snap.step) : 0n;
  const failedFill = attempt?.fill && phase?.kind === "failed";
  const complete = !!position && snap.solLamports > 0n && target > 0n &&
    snap.targetShort === target && snap.shortBase === target && !snap.venueStatus.liquidating && !failedFill;
  const facts = [
    !!position,
    snap.collateralBase > 0n,
    snap.solLamports > 0n,
    !!position && position.ratioBps > 0,
    complete,
  ];
  const steps = STEP_LABELS.map((label, index) => ({ label, done: facts[index] }));
  return {
    steps,
    next: complete ? 5 : facts.findIndex((done) => !done),
    complete,
    paused: false,
    body: failedFill && phase?.kind === "failed"
      ? phase.body
      : position && snap.solLamports > 0n && position.ratioBps > 0 && target === 0n
        ? "Your target rounds down to zero at Velocity’s minimum trade size. No short is open. Choose a higher percentage, or add SOL only if you want a larger position; syncing at this size won’t open a hedge."
        : "",
  };
}

export interface ScopePreferences {
  complete: boolean;
  releaseSeen: boolean;
  ruleSeen: boolean;
}

export interface TutorialPreferences {
  skipped: boolean;
  scopes: Record<string, ScopePreferences>;
}

export const emptyPreferences = (): TutorialPreferences => ({ skipped: false, scopes: {} });
const emptyScope = (): ScopePreferences => ({ complete: false, releaseSeen: false, ruleSeen: false });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function decodePreferences(raw: string | null): TutorialPreferences {
  if (!raw) return emptyPreferences();
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.skipped !== "boolean" || !isRecord(value.scopes)) return emptyPreferences();
    const scopes: Record<string, ScopePreferences> = {};
    for (const [scope, prefs] of Object.entries(value.scopes)) {
      if (isRecord(prefs) && typeof prefs.complete === "boolean" && typeof prefs.releaseSeen === "boolean" && typeof prefs.ruleSeen === "boolean")
        scopes[scope] = { complete: prefs.complete, releaseSeen: prefs.releaseSeen, ruleSeen: prefs.ruleSeen };
    }
    return { skipped: value.skipped, scopes };
  } catch {
    return emptyPreferences();
  }
}

export type PreferenceAction = "skip" | "restart" | "complete" | "releaseSeen" | "ruleSeen";

export function changePreferences(prefs: TutorialPreferences, scope: string, action: PreferenceAction): TutorialPreferences {
  if (action === "skip") return { ...prefs, skipped: true };
  if (action === "restart") return { skipped: false, scopes: { ...prefs.scopes, [scope]: emptyScope() } };
  return { ...prefs, scopes: { ...prefs.scopes, [scope]: { ...(prefs.scopes[scope] ?? emptyScope()), [action]: true } } };
}

export interface PreferenceStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export class TutorialPreferencesStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly storage: PreferenceStorage) {}

  async load(): Promise<TutorialPreferences> {
    return decodePreferences(await this.storage.getItem(TUTORIAL_KEY));
  }

  save(prefs: TutorialPreferences): Promise<void> {
    const value = JSON.stringify(prefs);
    const write = this.queue.catch(() => undefined).then(() => this.storage.setItem(TUTORIAL_KEY, value));
    this.queue = write;
    return write;
  }
}
