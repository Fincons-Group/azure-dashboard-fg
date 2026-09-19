export const NAV_HEIGHT = "57px";
export const SIDEBAR_WIDTH = "240px";
export const SIDEBAR_COLLAPSED_WIDTH = "64px";

// Shared between Sidebar and TopBar so the top nav bar paints the same dark
// chrome as the sidebar rail instead of following the light/dark content
// theme - the rail itself never follows that toggle either. Hardcoded
// (rather than theme tokens) because both bars intentionally stay dark
// regardless of the light/dark theme switch.
export const RAIL_BG = "#14181F";
export const RAIL_FG = "#B8BEC9";
export const RAIL_FG_ACTIVE = "#FFFFFF";

// The rail's one accent color - active nav indicator (Sidebar) and the
// active side of the theme-mode pill (ThemeSwitcher) both use it, so it's
// shared here instead of being redefined per component.
export const RAIL_ACCENT = "#0EA5A0";

// Larger than anything in Fluent's own radius scale (borderRadiusXLarge tops
// out at 8px) - a deliberate departure for the "modern" card language, not a
// token we forgot to reuse. Elevation itself still comes from Fluent's own
// theme-aware tokens.shadow4 rather than a new shadow constant, since that
// already reads as ~invisible on webDarkTheme the way the design mock wants.
export const CARD_RADIUS = "16px";
export const PILL_RADIUS = "999px";
