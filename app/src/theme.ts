export const color = {
  bg: "#F7F6F2",
  surface: "#FFFFFF",
  surfaceMuted: "#EFEEE8",
  border: "#E2E0D8",
  text: "#14161C",
  textMuted: "#5E6270",
  brand: "#2E3A8C",
  brandSoft: "#E8EAF7",
  hedge: "#7C86D1",
  onBrand: "#FFFFFF",
} as const;

export type Tone = "sync" | "drift" | "armed" | "ran" | "waiting" | "failed";

export const tone: Record<Tone, { fg: string; bg: string }> = {
  sync: { fg: "#23663F", bg: "#E8F4EC" },
  drift: { fg: "#8A5A14", bg: "#FFF4DE" },
  armed: { fg: "#5B3FB5", bg: "#F0EBFB" },
  ran: { fg: "#2E3A8C", bg: "#E8EAF7" },
  waiting: { fg: "#5E6270", bg: "#EFEEE8" },
  failed: { fg: "#B42318", bg: "#FDECEA" },
};

export const font = {
  display: "InstrumentSerif_400Regular",
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  mono: "JetBrainsMono_400Regular",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, huge: 48 } as const;
export const radius = { control: 10, card: 16, sheet: 24, pill: 999 } as const;
export const touch = 48;
