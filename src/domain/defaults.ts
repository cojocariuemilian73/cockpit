import type { Preset, Rule, Settings } from "./types";
import { DEFAULT_EXIT } from "./rules";

/** Portofelul DEMO pornește cu atâția SOL. */
export const DEMO_SOL = 10;

export const DEFAULT_RULES: Rule[] = [
  // limite de sesiune
  { id: "s-trades", kind: "session", enabled: true, type: "maxTradesPerDay", value: 3 },
  { id: "s-risk", kind: "session", enabled: true, type: "maxDailyRiskPct", value: 3 },
  { id: "s-cool", kind: "session", enabled: true, type: "cooldownAfterLosses", value: 2, minutes: 30 },
  { id: "s-pos", kind: "session", enabled: true, type: "maxPositionPct", value: 5 },
  { id: "s-nosize", kind: "session", enabled: true, type: "noSizeUpAfterLoss", value: 1 },
  { id: "s-words", kind: "session", enabled: true, type: "minThesisWords", value: 5 },
  // filtre token
  { id: "m-liq", kind: "metric", enabled: true, metric: "liquidityUsd", op: "min", value: 50_000, severity: "block" },
  { id: "m-dev", kind: "metric", enabled: true, metric: "devHoldPct", op: "max", value: 5, severity: "block" },
  { id: "m-bundle", kind: "metric", enabled: true, metric: "bundlePct", op: "max", value: 15, severity: "block" },
  { id: "m-top10", kind: "metric", enabled: true, metric: "top10Pct", op: "max", value: 30, severity: "warn" },
  { id: "m-holders", kind: "metric", enabled: true, metric: "holders", op: "min", value: 300, severity: "warn" },
  { id: "m-age", kind: "metric", enabled: true, metric: "ageMin", op: "min", value: 30, severity: "warn" },
  { id: "f-mint", kind: "flag", enabled: true, flag: "mintRenounced", severity: "block" },
  { id: "f-freeze", kind: "flag", enabled: true, flag: "freezeRenounced", severity: "block" },
  { id: "f-lp", kind: "flag", enabled: true, flag: "lpBurned", severity: "warn" },
  // ieșire
  DEFAULT_EXIT,
];

/** Presetările de execuție. Advanced păstrează valorile tale. */
export const PRESETS: Record<Exclude<Preset, "advanced">, { label: string; slippageBps: number; priorityFeeSol: number; hint: string }> = {
  turbo: { label: "Turbo", slippageBps: 300, priorityFeeSol: 0.005, hint: "alunecare 3%, prioritate mare: trece și când pool-ul se mișcă" },
  normal: { label: "Normal", slippageBps: 100, priorityFeeSol: 0.001, hint: "alunecare 1%, prioritate obișnuită" },
  safe: { label: "Safe", slippageBps: 50, priorityFeeSol: 0.0005, hint: "alunecare 0,5%: refuză pool-urile subțiri" },
};

export const DEFAULT_SETTINGS: Settings = {
  preset: "normal",
  slippageBps: 100,
  priorityFeeSol: 0.001,
  spikePct: 50,
  burstMax: 3,
  burstWindowMin: 10,
  tiltLosses: 3,
  staleSec: 30,
  requotePct: 3,
  bigPositionPct: 20,
  liveTick: true,
  notifications: false,
  orderTtlMin: 60,
};
