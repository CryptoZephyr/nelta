import { useRouter } from "expo-router";
import { useState } from "react";
import { useNelta } from "../store";
import { space } from "../theme";
import { useTutorial } from "../tutorial-ui";
import { Button, Card, Notice, Screen, T } from "../ui";

export default function Help() {
  const { owner } = useNelta();
  const { ready, change, retrySave, storageError } = useTutorial();
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const restart = async () => {
    setSaving(true);
    await change("restart");
    setSaving(false);
    router.replace(owner ? "/home" : "/");
  };
  return (
    <Screen>
      <T v="h1">Help</T>
      <Card>
        <T v="h2">First-time guide</T>
        <T v="body" style={{ marginTop: space.sm }}>Walk through setup using this wallet’s confirmed position. Existing collateral, SOL and a matching hedge are recognized, so you won’t be asked to repeat completed steps.</T>
        <Button label="Restart tutorial" disabled={!ready} loading={saving} onPress={() => void restart()} />
        <T v="caption">Restarting only changes guidance on this device. It doesn’t deposit funds, change your hedge or send a transaction.</T>
      </Card>
      {storageError && (
        <>
          <Notice tone="waiting" title="Preferences weren’t saved" body={storageError} />
          <Button label="Try saving preferences again" kind="secondary" onPress={() => void retrySave()} />
        </>
      )}
      <Card>
        <T v="h2">Check your actual hedge</T>
        <T v="body" style={{ marginTop: space.sm }}>Adding SOL or saving a percentage doesn’t open a short. Home shows the actual short and its target. If a transaction is uncertain, check its receipt in Activity before retrying.</T>
        {owner && <Button label="Open Activity" kind="secondary" onPress={() => router.push("/activity")} />}
      </Card>
      {owner && (
        <Card>
          <T v="h2">Recovery</T>
          <T v="body" style={{ marginTop: space.sm }}>Switch off a rule, close the remaining short and withdraw funds through the existing recovery steps.</T>
          <Button label="Open Recovery" kind="secondary" onPress={() => router.push("/recovery")} />
        </Card>
      )}
    </Screen>
  );
}
