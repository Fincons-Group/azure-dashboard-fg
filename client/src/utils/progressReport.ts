import type {
    TestPlanProgressCounts,
    TestPlanProgressNode,
} from "../types";

export interface SuiteFilterOption {
    id: number;
    path: string;
}

function zeroCounts(): TestPlanProgressCounts {
    return {
        total: 0,
        passed: 0,
        failed: 0,
        blocked: 0,
        notApplicable: 0,
        notExecuted: 0,
    };
}

function addCounts(
    a: TestPlanProgressCounts,
    b: TestPlanProgressCounts
): TestPlanProgressCounts {
    return {
        total: a.total + b.total,
        passed: a.passed + b.passed,
        failed: a.failed + b.failed,
        blocked: a.blocked + b.blocked,
        notApplicable: a.notApplicable + b.notApplicable,
        notExecuted: a.notExecuted + b.notExecuted,
    };
}

export function sumCounts(
    nodes: TestPlanProgressNode[]
): TestPlanProgressCounts {
    return nodes.reduce(
        (total, node) => addCounts(total, node.counts),
        zeroCounts()
    );
}

// Leaf (Level3) nodes only - these are the individually-filterable test
// suites in the real Progress Report's "Test Suites" picker.
export function collectLeafOptions(
    nodes: TestPlanProgressNode[],
    pathPrefix: string[] = []
): SuiteFilterOption[] {
    return nodes.flatMap((node) => {
        const path = [...pathPrefix, node.title];

        if (node.children.length === 0) {
            return [{ id: node.id, path: path.join(" / ") }];
        }

        return collectLeafOptions(node.children, path);
    });
}

// Keeps only branches that lead to a selected leaf, re-summing parent
// counts from the kept children so percentages stay correct after
// narrowing the tree to a subset of suites.
export function filterProgressTree(
    nodes: TestPlanProgressNode[],
    selectedLeafIds: Set<number>
): TestPlanProgressNode[] {
    if (selectedLeafIds.size === 0) {
        return nodes;
    }

    return nodes
        .map((node) => {
            if (node.children.length === 0) {
                return selectedLeafIds.has(node.id) ? node : null;
            }

            const filteredChildren = filterProgressTree(
                node.children,
                selectedLeafIds
            );

            if (filteredChildren.length === 0) {
                return null;
            }

            return {
                ...node,
                children: filteredChildren,
                counts: sumCounts(filteredChildren),
            };
        })
        .filter((node): node is TestPlanProgressNode => node !== null);
}

export function runPercent(counts: TestPlanProgressCounts): number {
    if (counts.total === 0) {
        return 0;
    }

    return Math.round(
        ((counts.total - counts.notExecuted - counts.notApplicable) /
            counts.total) *
            100
    );
}

export function passedPercent(counts: TestPlanProgressCounts): number {
    if (counts.total === 0) {
        return 0;
    }

    return Math.round((counts.passed / counts.total) * 100);
}

// Not Applicable cases are neither a pass nor a fail, so they shouldn't
// dilute the pass rate - same convention as CoverageSection's
// suitePassRateExcludingNA.
export function passedPercentExclNA(counts: TestPlanProgressCounts): number {
    const applicable = counts.total - counts.notApplicable;

    if (applicable === 0) {
        return 0;
    }

    return Math.round((counts.passed / applicable) * 100);
}

export function failedPercent(counts: TestPlanProgressCounts): number {
    if (counts.total === 0) {
        return 0;
    }

    return Math.round((counts.failed / counts.total) * 100);
}
