import assert from "node:assert/strict";
import test from "node:test";
import { resolveOutcome, resolveTestPointStatus } from "./dashboardData.js";

test("N/A is neutral across configurations, but is never itself executed", () => {
    assert.equal(resolveOutcome(["passed", "notApplicable"]), "Passed");
    assert.equal(resolveOutcome(["notApplicable", "notApplicable"]), "NotApplicable");
    assert.equal(resolveOutcome(["notApplicable", "notrun"]), "NotRun");
    assert.equal(resolveOutcome(["passed", "notrun"]), "NotRun");
});

test("failed and blocked verdicts take precedence over N/A", () => {
    assert.equal(resolveOutcome(["failed", "notApplicable"]), "Failed");
    assert.equal(resolveOutcome(["blocked", "notApplicable"]), "Blocked");
});

test("a stale point verdict is not counted until the latest result is completed", () => {
    assert.equal(resolveTestPointStatus({ results: { outcome: "passed", lastResultState: "Pending" } }), "inprogress");
    assert.equal(resolveTestPointStatus({ results: { outcome: "passed", lastResultState: "Completed" } }), "passed");
    assert.equal(resolveTestPointStatus({ results: { outcome: "failed" } }), "notrun");
});
