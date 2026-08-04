# QA Dashboard — KPI Improvement Plan

## Context

This plan identifies KPI gaps in the current dashboard and defines new metrics to add, prioritised by stakeholder value. The current dashboard covers 30+ metrics but they are **activity-oriented** (what ran, what failed) rather than **value-oriented** (how QA impacted quality and speed of delivery). Stakeholders cannot answer "is the QA team doing a good job?" from the current data alone.

> **Scope note:** Automation KPIs are out of scope for this iteration and will be addressed separately.

---

## Implementation Status (updated 2026-07-10)

**P1 is done and shipped**, as a single new `/release-readiness` page rather than four separate additions to existing pages. Everything in P1 lives behind one feature flag so it can be hidden until it's ready for stakeholders:

- `ENABLE_RELEASE_READINESS` (backend, `.env`) + `VITE_ENABLE_RELEASE_READINESS` (frontend, `client/.env`) — both `false` by default in `.env.example`, both `true` in the local dev `.env` files.

**Key files:**
- `src/releaseReadinessData.ts` — all computation (gate criteria, completion, pass-rate delta, blocking defects)
- `src/sprints.ts` — hand-maintained real sprint calendar (see 1.2/1.3 below)
- `client/src/pages/ReleaseReadinessPage.tsx` — the page UI
- Wired through `src/server.ts` (`GET /api/release-readiness`), `src/types.ts` / `client/src/types.ts`, `client/src/api/client.ts`, `client/src/App.tsx`, `client/src/components/NavBar.tsx`, and both `en.json`/`it.json` locales

**The single biggest deviation from this doc:** 1.1's originally-planned weighted 0–100 score was scrapped mid-build in favor of implementing the org's actual formal exit-criteria checklist (`code_coverage.md`, "Criteri di Accettazione - Test Funzionali Manuali") as a literal BLOCK/WARN gate. See 1.1 below for the full criteria list and the field-mapping caveats (Severity used instead of Priority, requirements coverage not yet trackable). If you're about to re-derive scoring logic for this area, read 1.1 first — it's already been through two design iterations.

**Not started:** the "Recommended New Page: Executive Summary" section further down is still just a proposal — nothing built there yet.

---

## Current State — What We Already Have

| Category | KPIs Present |
|---|---|
| Test Execution | Pass rate, blocked/failed counts, not-run count |
| Defects | MTTR, leakage, rejection, reopen, duplicate, first-time fix |
| Progress | Suite/plan rollup, run cards |
| Errors | Top error signatures |

---

## Priority 1 — High Value, Low-to-Medium Effort

### 1.1 Quality Health Score & RAG Status — ✅ Implemented (redesigned)
**Stakeholders:** Product Owners, Release Managers, C-Level

**What actually shipped is not the composite score originally planned below.** Partway through, the org's real formal exit-criteria doc (`code_coverage.md`, "Criteri di Accettazione - Test Funzionali Manuali") surfaced, and the implementation was redone to reproduce that checklist literally instead of a made-up weighted formula. Do not reintroduce the 0–100 score — it was deliberately replaced.

**Actual model — BLOCK/WARN gate**, computed in `src/releaseReadinessData.ts` (`buildGateCriteria` / `computeReleaseGate`):

| Criterion | Target | Action | Notes |
|---|---|---|---|
| Test Cases Executed | 100% | BLOCK | `executedCount / plannedCount`, scoped (see 1.2) |
| Test Superati (passed) | 95% | BLOCK | `passedCount / executedCount` — **not** `passed/total`, that was a bug caught and fixed mid-build |
| Requirements Coverage | 95% | BLOCK | **Not tracked** — `tracked: false`, excluded from pass/fail. Blocked on 3.1 (Requirements Traceability); implement 3.1 first, then wire its output in here |
| Critical Defects Open | 0 | BLOCK | Severity `"1 - Critical"`, open only |
| High Defects Open | 0 | BLOCK | Severity `"2 - High"`, open only |
| Medium Defects Open | tracked | WARN | Severity `"3 - Medium"`, open only |
| Low Defects Open | tracked | WARN | Severity `"4 - Low"`, open only |

RAG = **Red** if any tracked BLOCK criterion fails, **Amber** if only a WARN criterion fails, **Green** otherwise. Untracked criteria never affect RAG.

**Important field-mapping decision:** `code_coverage.md` gates defects by *Priority* (P1–P4), but this project's Azure DevOps data barely populates Priority (nearly every bug is "Priority 2") — *Severity* is the field the team actually maintains, so the P1/P2 BLOCK / P3/P4 WARN rows are mapped onto Severity instead. If a future project has real Priority data, this mapping should switch back.

**Defect scoping:** intentionally **not** filtered by suite or plan — all open bugs project-wide count toward these criteria (explicit decision: bugs aren't reliably linked to a single test plan, unlike test cases).

Thresholds are configurable: `RELEASE_GATE_TESTS_EXECUTED_TARGET_PCT` (100), `RELEASE_GATE_TESTS_PASSED_TARGET_PCT` (95), `RELEASE_GATE_REQUIREMENTS_COVERAGE_TARGET_PCT` (95, display-only until 3.1 lands).

Lives on the new `/release-readiness` page (not `/plan-progress`), gated by `ENABLE_RELEASE_READINESS`.

<details><summary>Original plan (superseded, kept for history)</summary>

A single composite score (0–100) that weights pass rate, critical open defects, and not-executed % against configurable exit criteria thresholds. Derived RAG (Red / Amber / Green) status per plan/sprint.

**Logic:**
- Green: pass rate ≥ 95%, 0 critical open bugs, not-run ≤ 2%
- Amber: pass rate ≥ 80%, ≤ 2 critical open bugs, not-run ≤ 10%
- Red: anything below Amber thresholds

**Exit Criteria Met %:** how many of the defined quality gates have been satisfied (e.g., "7/10 criteria met").

</details>

---

### 1.2 Sprint Test Completion Rate & Carry-Over — ✅ Implemented
**Stakeholders:** QA Manager, Scrum Master, PMO

- **Sprint Test Completion Rate** — % of planned test cases actually executed by sprint end
- **Carry-Over Test Cases** — test cases not executed that slipped to the next sprint (direct measure of under-capacity or late dev delivery)

**As built (deviates from the plan below):**
- No snapshot storage, no Azure DevOps Iterations API integration. Instead `src/sprints.ts` hand-maintains the org's **real sprint calendar** (13 sprints, obtained from an export, not from a live API) — each sprint's start/end dates literally overlap by several months (roughly 6-month spans staggered ~monthly), which is unusual but confirmed correct by the team. `getCurrentSprint()` resolves overlaps by array order (lowest-numbered/earliest-starting match wins), which naturally walks Sprint 1 → 2 → 3... forward as time passes without extra logic.
- Completion/pass-rate numbers are **scoped to specific test plans**: only plans whose name matches `/\b(test funzionali|uat)\b/i` count (`isFunctionalTestPlan` in `src/releaseReadinessData.ts`). This excludes the "Test DSI" plan, which `code_coverage.md` attributes to a different owner ("Test Factory Esterna" only). If new plan names are added later, check this regex still matches them.
- "Carry-over" only activates once the sprint's real end date has passed (`sprint.hasEnded`) — before that, not-yet-executed test cases are just in-flight work, not carry-over.
- Pre-2026-07-07 activity (Azure DevOps capability trials, not real testing) is already excluded via the existing `SPRINT_1_START_DATE` cutoff in `dashboardData.ts` — didn't need duplicating in `sprints.ts`.

<details><summary>Original plan (superseded, kept for history)</summary>

- Already in `TestPlanProgressCounts` — compare planned count at sprint start vs actual executed at sprint end
- Requires either snapshot storage (persist a JSON per sprint) or use Azure DevOps iteration dates to filter the OData history

</details>

---

### 1.3 Sprint-over-Sprint Pass Rate Delta — ✅ Implemented
**Stakeholders:** QA Manager, Engineering Leadership, Scrum Master

Did quality improve or regress vs the previous sprint? Surface as a delta indicator (arrow + % change).

**As built:** `sprintPassRateFromTrend()` in `src/releaseReadinessData.ts` buckets the existing daily `computeExecutionTrend()` series into each sprint's `[startDate, endDate]` window (using the real calendar from 1.2) and computes `passed / (passed+failed+blocked)` per window, then diffs current vs previous. Currently always shows "no prior sprint" since Sprint 1 is first in the calendar and has no predecessor — this is expected, not a bug, until Sprint 2's window has trend data. Lives on the `/release-readiness` page as a stat card, not a delta column on the existing trend view.

---

### 1.4 Blocking Defects at Release — ✅ Implemented
**Stakeholders:** Product Owners, Release Managers

Count of open Severity 1 and Severity 2 bugs still unresolved at sprint close, tracked over time as a trend.

**As built:** `blockingDefects` in `src/releaseReadinessData.ts` — open bugs with Severity `"1 - Critical"` or `"2 - High"`, project-wide (not scoped to a plan or sprint-boundary snapshot; see the defect-scoping note under 1.1). Shown as a stat card + full table (reusing the existing `BugsTable` component) on `/release-readiness`. No historical trend was built for this specific metric — the existing `DefectStats.backlogTrend`/`backlogDirection` on the Defects page already covers backlog trend generally and wasn't worth duplicating.

---

## Priority 2 — High Value, Medium Effort

### 2.1 QA Team Productivity per Tester per Sprint
**Stakeholders:** QA Manager, HR, Engineering Leadership

Shows what each team member contributed — makes individual and team throughput visible without requiring a separate tracker.

**KPIs:**
- Test cases executed per tester per sprint
- Bug reports raised per tester per sprint
- Test execution velocity (tests completed per day during the active test window)

**Implementation:**
- Work Items API already returns `assignee` on test results
- Group `TestPointHistorySnapshot` by tester identity — already available in OData
- New chart/table on `/defects` or a new `/team-productivity` page
- Effort: Medium

---

### 2.2 Defect Detection Phase Breakdown
**Stakeholders:** Engineering Leadership, Product, Audit

Shows in which phase bugs were found: Dev | QA | UAT | Production. The earlier the phase, the cheaper the fix — this makes QA's cost-saving contribution visible.

**Prerequisite:** A "Found In" environment field must exist (or be created) on Azure DevOps work items.

**KPIs:**
- % bugs found in each phase (donut chart)
- Trend of phase distribution over sprints

**Implementation:**
- If "Found In" custom field exists: filter `defectData.ts` on that field
- Add donut chart to the existing `/defects` page
- Effort: Medium (Low if field already exists)

---

### 2.3 Defect Escape Rate
**Stakeholders:** Engineering Leadership, Product, Audit

% of total bugs that were first reported in production (not found by QA). This is the single most important QA quality indicator for external stakeholders.

**Formula:** `Production bugs / (QA bugs + UAT bugs + Production bugs) × 100`

**Prerequisite:** Same "Found In" environment field as 2.2.

**Implementation:**
- Once "Found In" field is tagged: add a dedicated metric card to `/defects` overview tab
- Show trend over last N sprints
- Effort: Medium (depends on 2.2 prerequisite)

---

### 2.4 Bug Fix Validation Cycle Time
**Stakeholders:** QA Manager, Scrum Master

Average time (hours/days) from a bug being marked "Fixed/Resolved" by dev to QA completing the retest. Highlights bottlenecks in the dev↔QA handoff loop.

**Implementation:**
- Work Item Revisions API already used for reopen tracking
- Compute delta between state transition timestamps: `Resolved` → `Active` (retest failed) or `Resolved` → `Closed` (retest passed)
- Add a metric card + distribution histogram to `/defects`
- Effort: Medium

---

## Priority 3 — Medium Value, Higher Effort

### 3.1 Requirements Traceability Coverage
**Stakeholders:** Product Owners, Business Analysts, Compliance/Audit

% of user stories / acceptance criteria that have at least one linked test case. Identifies stories being shipped without test coverage.

**KPIs:**
- Requirements coverage % overall
- Untested stories per sprint (user stories with no associated test execution)
- Test case density per story point (avg test cases per story point)
- New feature test coverage rate (for newly delivered features this sprint)

**Prerequisite:** Test cases must be linked to user stories in Azure DevOps (via Related Work links).

**Implementation:**
- Requires querying Work Item links via REST API to map test cases → stories
- New backend function in `src/` and a new page or tab
- Effort: High

---

### 3.2 Test Case Effectiveness Rate
**Stakeholders:** QA Manager (internal QA use)

How targeted is the test suite? Low-effectiveness tests are bloated or misaligned to risk.

**Formula:** `Bugs found / Total test cases executed × 100`

**Implementation:**
- Cross-reference failed test cases that have linked bugs
- Add as a metric card to the existing `/test-execution` page
- Effort: Low

---

### 3.3 Defect Injection Rate
**Stakeholders:** Engineering Leadership, Scrum Master

New bugs opened / story points delivered per sprint. Shows whether development quality is improving or degrading sprint over sprint.

**Prerequisite:** Story point data must be accessible (from linked user stories in the same iteration).

**Implementation:**
- Combine defect count per sprint (already available) with story points from AZDO sprint work items
- Add a trend chart to `/defects`
- Effort: Medium-High

---

## Recommended New Page: Executive Summary

The highest single-impact addition is a new `/executive-summary` page that consolidates:

1. **Quality Health Score** — large dial/gauge (0–100)
2. **RAG release readiness** — per active sprint/plan
3. **Sprint comparison table** — last 4 sprints: pass rate, defects opened, defects closed, escape rate
4. **Top 3 risks** — highest-severity open defects blocking release
5. **QA team throughput** — tests executed this sprint vs last sprint
6. **Defect trend** — backlog growing/stable/shrinking (`DefectStats.backlogDirection` already computed)

This page makes the dashboard usable in a stakeholder review meeting without requiring the audience to navigate 14 routes.

---

## Priority & Effort Summary

| # | KPI | Stakeholder | Effort | Priority | Status |
|---|---|---|---|---|---|
| 1.1 | Quality Health Score / RAG | C-Level, PO, RM | Medium | **P1** | ✅ Done (as BLOCK/WARN gate, not a score) |
| 1.2 | Sprint Test Completion Rate + Carry-Over | QA Mgr, Scrum | Low | **P1** | ✅ Done |
| 1.3 | Sprint-over-Sprint Pass Rate Delta | QA Mgr, Engineering | Low | **P1** | ✅ Done |
| 1.4 | Blocking Defects at Release | PO, RM | Low | **P1** | ✅ Done |
| 2.1 | QA Team Productivity per Tester | QA Mgr, HR | Medium | **P2** | Not started |
| 2.2 | Detection Phase Breakdown | Engineering, Audit | Medium | **P2** | Not started |
| 2.3 | Defect Escape Rate | Engineering, PO | Medium | **P2** | Not started |
| 2.4 | Bug Fix Validation Cycle Time | QA Mgr, Scrum | Medium | **P2** | Not started |
| 3.1 | Requirements Traceability Coverage | PO, BA, Audit | High | **P3** | Not started — now also unblocks 1.1's requirements-coverage gate |
| 3.2 | Test Case Effectiveness Rate | QA Team | Low | **P3** | Not started |
| 3.3 | Defect Injection Rate | Engineering, Scrum | Medium-High | **P3** | Not started |

---

## Pre-Implementation Checklist

Before starting P2 items, confirm the following in Azure DevOps:

- [ ] Is there a "Found In" / "Environment" field on bug work items? (Unlocks 2.2 and 2.3)
- [x] Are exit criteria thresholds defined for pass rate, critical bugs, not-run %? (Unlocks 1.1) — resolved via `code_coverage.md`, the org's real exit-criteria doc; see 1.1 above
- [ ] Are test cases linked to user stories via "Related Work" links? (Unlocks 3.1, and now also the requirements-coverage gate in 1.1)
- [ ] Is "Story Points" field populated on sprint stories? (Unlocks 3.3)
- [x] Is iteration / sprint start-end date data reliable in AZDO? (Unlocks 1.2 snapshot approach) — resolved without AZDO Iterations API: real sprint calendar hand-maintained in `src/sprints.ts` instead

---

## Notes

- All P1 items can be built from data already available via existing Azure DevOps OData and REST API calls — no new data sources required.
- P2 items require either a new custom field in Azure DevOps ("Found In") or additional API calls to work item revisions.
- P3 items require structural prerequisites in Azure DevOps (linked work items, story points) that the QA/dev team must align on first.
- The Executive Summary page should be built alongside or immediately after P1 items, as it is the primary stakeholder-facing output. **Still not started** as of 2026-07-10, despite P1 itself being done — pick this up next if stakeholder-facing reporting is the priority, or move to P2 if internal QA process metrics matter more right now.
- When picking up 3.1 (Requirements Traceability): its output should also be wired into 1.1's "Requirements Coverage" gate criterion (`src/releaseReadinessData.ts`, currently hardcoded `tracked: false`) — don't build it as a fully separate feature without closing that loop.
