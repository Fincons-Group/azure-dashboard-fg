import type { Outcome } from "../types";

// Shared fixed palette for outcome indicators rendered inside the dark
// Status Report card. Keeping it outside the components prevents the same
// outcome from drifting to a different colour in KPI and suite views.
export const OUTCOME_COLORS: Record<Outcome, string> = {
    Passed: "#3fb950",
    Failed: "#d13438",
    Blocked: "#eda100",
    Paused: "#b180d7",
    InProgress: "#3aa0f3",
    NotApplicable: "#8a8886",
    NotRun: "#8a8886",
};
