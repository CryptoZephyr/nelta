import { InstrumentSerif_400Regular } from "@expo-google-fonts/instrument-serif";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { JetBrainsMono_400Regular } from "@expo-google-fonts/jetbrains-mono";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { FlowSheet } from "../sheet";
import { NeltaProvider } from "../store";
import { color, font } from "../theme";

export default function RootLayout() {
  const [loaded] = useFonts({ InstrumentSerif_400Regular, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, JetBrainsMono_400Regular });
  if (!loaded) return null;
  return (
    <SafeAreaProvider>
      <NeltaProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShadowVisible: false,
            headerStyle: { backgroundColor: color.bg },
            headerTitleStyle: { fontFamily: font.semibold, color: color.text },
            headerTintColor: color.brand,
            contentStyle: { backgroundColor: color.bg },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="release" options={{ title: "Release now" }} />
          <Stack.Screen name="funds" options={{ title: "Add funds" }} />
          <Stack.Screen name="recovery" options={{ title: "Recovery" }} />
        </Stack>
        <FlowSheet />
      </NeltaProvider>
    </SafeAreaProvider>
  );
}
