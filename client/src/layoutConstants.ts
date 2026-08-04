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
