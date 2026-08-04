import type { SprintInfo } from "./types.js";

interface SprintDef {
    id: number;
    name: string;
    startDate: string;
    endDate: string;
}

// Sprint boundaries aren't sourced from Azure DevOps yet (no Iterations API
// integration) - maintained by hand from the org's real sprint calendar.
// Dates are inclusive, YYYY-MM-DD, sorted oldest first. Ranges legitimately
// overlap by several months (each sprint here spans ~6 months, staggered
// roughly monthly) - getCurrentSprint()/getPreviousSprint() below rely on
// array order to resolve ties, so a reference date landing in more than one
// sprint's range always resolves to the lowest-numbered (earliest-starting)
// match, which walks forward sequentially as time passes.
//
// Any activity dated before 2026-07-07 is pre-real-testing noise (Azure
// DevOps capability trials, not actual Sprint 1 work) and is already
// excluded independently via SPRINT_1_START_DATE in dashboardData.ts - these
// sprint boundaries are only used for display and for bucketing the
// (already-filtered) execution trend, so that cutoff doesn't need to be
// duplicated here.
const SPRINTS: SprintDef[] = [
    { id: 1, name: "Sprint 1", startDate: "2026-01-26", endDate: "2026-07-30" },
    { id: 2, name: "Sprint 2", startDate: "2026-02-16", endDate: "2026-09-03" },
    { id: 3, name: "Sprint 3", startDate: "2026-03-23", endDate: "2026-11-03" },
    { id: 4, name: "Sprint 4", startDate: "2026-04-13", endDate: "2026-11-05" },
    { id: 5, name: "Sprint 5", startDate: "2026-05-12", endDate: "2026-12-03" },
    { id: 6, name: "Sprint 6", startDate: "2026-06-11", endDate: "2027-01-11" },
    { id: 7, name: "Sprint 7", startDate: "2026-07-10", endDate: "2027-02-15" },
    { id: 8, name: "Sprint 8", startDate: "2026-08-07", endDate: "2027-03-11" },
    { id: 9, name: "Sprint 9", startDate: "2026-09-18", endDate: "2027-04-08" },
    { id: 10, name: "Sprint 10", startDate: "2026-10-16", endDate: "2027-05-06" },
    { id: 11, name: "Sprint 11", startDate: "2026-11-13", endDate: "2027-06-03" },
    { id: 12, name: "Sprint 12", startDate: "2026-12-11", endDate: "2027-07-01" },
    { id: 13, name: "Sprint 13", startDate: "2027-01-19", endDate: "2027-07-29" },
];

function todayDateString(): string {
    return new Date().toISOString().slice(0, 10);
}

// Returns the sprint containing referenceDate, or the most recent sprint if
// referenceDate falls after every defined sprint (i.e. the next sprint
// hasn't been added yet).
export function getCurrentSprint(
    referenceDate: string = todayDateString()
): SprintInfo {
    const active = SPRINTS.find(
        (s) => referenceDate >= s.startDate && referenceDate <= s.endDate
    );

    const sprint = active ?? SPRINTS[SPRINTS.length - 1];

    return {
        ...sprint,
        hasEnded: referenceDate > sprint.endDate,
    };
}

export function getPreviousSprint(current: SprintInfo): SprintInfo | null {
    const index = SPRINTS.findIndex((s) => s.id === current.id);

    if (index <= 0) {
        return null;
    }

    return { ...SPRINTS[index - 1], hasEnded: true };
}
