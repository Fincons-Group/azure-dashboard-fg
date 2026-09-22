import { tokens } from "@fluentui/react-components";

export type StatusTone = "success" | "warning" | "danger" | "neutral";

// Fluent's own semantic palette tokens are already theme-aware (the same
// tokens RunHistoryStrip's dotColor() uses), so a tone needs no light/dark
// branching of its own - unlike the hex maps StatusTag replaces.
// Exported so other status-colored bits (progress bars, task dots) can share
// the exact same tone->color mapping instead of redefining it. Kept out of
// StatusTag.tsx itself so that file only exports the component (Fast Refresh
// requirement enforced by eslint's react-refresh/only-export-components).
export const STATUS_TONE_COLOR: Record<StatusTone, string> = {
    success: tokens.colorPaletteGreenForeground1,
    warning: tokens.colorPaletteMarigoldForeground1,
    danger: tokens.colorPaletteRedForeground1,
    neutral: tokens.colorNeutralForeground3,
};
