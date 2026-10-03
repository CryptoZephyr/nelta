import { Redirect } from "expo-router";
import { ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Tabs from "expo-router/js-tabs";
import { Icon, IconName } from "../../icons";
import { useNelta } from "../../store";
import { color, font } from "../../theme";

const tab = (title: string, icon: IconName) => ({
  title,
  tabBarIcon: ({ color: tint }: { color: ColorValue }) => <Icon name={icon} size={22} tint={tint} />,
});

export default function TabsLayout() {
  const { owner } = useNelta();
  const insets = useSafeAreaInsets();
  if (!owner) return <Redirect href="/" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.brand,
        tabBarInactiveTintColor: color.textMuted,
        tabBarStyle: { backgroundColor: color.surface, borderTopColor: color.border, height: 64 + insets.bottom, paddingTop: 6, paddingBottom: insets.bottom },
        tabBarLabelStyle: { fontFamily: font.medium, fontSize: 12 },
        sceneStyle: { backgroundColor: color.bg },
      }}
    >
      <Tabs.Screen name="home" options={tab("Home", "home")} />
      <Tabs.Screen name="rule" options={tab("Rule", "rule")} />
      <Tabs.Screen name="activity" options={tab("Activity", "list")} />
    </Tabs>
  );
}
