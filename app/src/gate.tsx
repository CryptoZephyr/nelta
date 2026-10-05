import { useRouter } from "expo-router";
import { useState } from "react";
import { Snapshot } from "./nelta";
import { useNelta } from "./store";
import { Button, ErrorState, Loading, Notice } from "./ui";

/** Loading, read-error and no-position states shared by screens that need a position. Null once there's one. */
export function PositionGate({ snap }: { snap: Snapshot | null }) {
  const { readError, refresh } = useNelta();
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  if (snap?.position) return null;
  if (!snap && readError) {
    const retry = async () => {
      setRetrying(true);
      await refresh();
      setRetrying(false);
    };
    return <ErrorState title="Couldn’t read Devnet" body={`${readError}. Your funds aren’t affected.`} onRetry={() => void retry()} retrying={retrying} />;
  }
  if (!snap) return <Loading label="Reading your position from Devnet…" />;
  return (
    <>
      <Notice tone="waiting" title="No position yet" body="Create your position on Home first. It takes one approval." />
      <Button label="Go to Home" onPress={() => router.replace("/home")} />
    </>
  );
}
