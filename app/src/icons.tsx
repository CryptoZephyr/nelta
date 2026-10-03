import { ColorValue } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { color } from "./theme";

export type IconName = "link" | "unlink" | "shield" | "zap" | "lifebuoy" | "clock" | "check" | "home" | "rule" | "list" | "arrow" | "x" | "wallet";

const paths: Record<IconName, string[]> = {
  link: ["M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7", "M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"],
  unlink: ["M18.8 13.3l1.7-1.8a5 5 0 0 0-7-7L11.7 6.2", "M5.2 10.7l-1.7 1.8a5 5 0 0 0 7 7l1.8-1.7", "M8 2v3", "M2 8h3", "M16 22v-3", "M22 16h-3"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", "M9 12l2 2 4-4"],
  zap: ["M13 2L3 14h9l-1 8 10-12h-9l1-8z"],
  lifebuoy: ["M4.9 4.9l4.3 4.3", "M14.8 14.8l4.3 4.3", "M14.8 9.2l4.3-4.3", "M4.9 19.1l4.3-4.3"],
  clock: ["M12 6v6l4 2"],
  check: ["M20 6L9 17l-5-5"],
  home: ["M3 10.5L12 3l9 7.5V21h-6v-6H9v6H3z"],
  rule: ["M4 6h16", "M4 12h10", "M4 18h6", "M17 15l3 3-3 3"],
  list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  arrow: ["M5 12h14", "M13 6l6 6-6 6"],
  x: ["M18 6L6 18", "M6 6l12 12"],
  wallet: ["M3 7h15a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7z", "M3 7l12-4v4", "M16 14h.01"],
};

const circles: Partial<Record<IconName, [number, number, number][]>> = {
  lifebuoy: [[12, 12, 10], [12, 12, 4]],
  clock: [[12, 12, 10]],
};

export function Icon({ name, size = 20, tint = color.text }: { name: IconName; size?: number; tint?: ColorValue }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={tint} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {circles[name]?.map(([cx, cy, r]) => <Circle key={`${cx}${r}`} cx={cx} cy={cy} r={r} />)}
      {paths[name].map((d) => <Path key={d} d={d} />)}
    </Svg>
  );
}

/** Nelta mark: two parallel strokes joined by one bridge. */
export function Mark({ size = 24, tint = color.brand }: { size?: number; tint?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={tint} strokeWidth={2.6} strokeLinecap="round">
      <Path d="M4 7h16" />
      <Path d="M4 17h11" />
      <Path d="M12 7v10" />
    </Svg>
  );
}
