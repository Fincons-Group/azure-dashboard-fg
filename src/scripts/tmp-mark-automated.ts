import "dotenv/config";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { getWorkItems, updateWorkItemFields, buildWorkItemUrl } from "../azdo.js";

const PROJECT = "Test Factory";
const DRY_RUN = process.argv.includes("--dry-run");
const ONLY_ONE = process.argv.includes("--only-one");

const TST_E2E_ROOT =
    "C:\\Users\\anderson.cahet\\OneDrive - Fincons Spa\\Documents\\projetoNEVE\\tst-e2e";

const AUTOMATION_FIELDS = [
    "System.Id",
    "System.Title",
    "Microsoft.VSTS.TCM.AutomationStatus",
];

interface SpecMapping {
    testCaseId: number;
    suiteLabel: "A11Y" | "Security";
    testName: string;
    relPath: string; // e.g. tst-e2e\src\tests\a11y\sprint01\front-office-auto\impersona-page-a11y.spec.ts
}

// Node's fs.readdirSync on this OneDrive-synced checkout returned an
// inconsistent partial listing across runs (8 of 14 a11y files one time,
// all 14 another) - a known Files On-Demand placeholder quirk. `git
// ls-files` reads the tracked-file list from the index instead of walking
// the live directory, which was consistent across repeated checks.
function listSpecFiles(root: string, subdir: string): string[] {
    // git's own -C flag, not execFileSync's `cwd` option - the latter proved
    // unreliable against this OneDrive-synced path (some runs silently
    // resolved to the wrong repo and returned zero matches instead of
    // erroring).
    const output = execFileSync(
        "git",
        ["-C", root, "ls-files", "--", `${subdir}/**/*.spec.ts`],
        { encoding: "utf8" }
    );
    return output
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((rel) => path.join(root, rel));
}

// Each test() block in the a11y/security specs is tagged with the exact ADO
// test case id it automates - '@[a11y8952]' for a11y specs, '@[8977]' for
// security/ZAP specs (see src/tests/a11y/.../impersona-page-a11y.spec.ts).
// This is the real linkage the placeholder scheme from the last run stood
// in for - use it instead now that it's available.
function extractMappings(root: string, suiteLabel: "A11Y" | "Security"): SpecMapping[] {
    const subdir = "src/tests/" + (suiteLabel === "A11Y" ? "a11y" : "security");
    const files = listSpecFiles(root, subdir);

    const mappings: SpecMapping[] = [];
    // Title and tag are arguments of the SAME test(...) call (see
    // impersona-page-a11y.spec.ts: `test('title', { tag: '@[a11y8952]' }, ...)`),
    // just possibly on different lines - match both within one call's args
    // rather than nearest-line heuristics, which mismatched titles to tags
    // whenever a file had more than one test() block.
    // Exclude test.step(...) - those also match `test(...)`'s shape and
    // sit between a real test()'s title and its tag object in several
    // files, so an unqualified pattern grabs the step's descriptive Italian
    // title (and truncates on the first apostrophe in it) instead of the
    // real test() title.
    const callPattern =
        /\btest(?!\.step\b)(?:\.\w+)?\(\s*['"]([^'"]+)['"][\s\S]{0,400}?tag:\s*'@\[(?:a11y)?(\d+)\]'/g;

    for (const file of files) {
        const content = readFileSync(file, "utf8");
        const relPath = "tst-e2e\\" + path.relative(root, file);

        for (const match of content.matchAll(callPattern)) {
            const [, testName, idStr] = match;
            mappings.push({
                testCaseId: Number(idStr),
                suiteLabel,
                testName,
                relPath,
            });
        }
    }
    return mappings;
}

function buildFields(m: SpecMapping) {
    const hexId = m.testCaseId.toString(16).padStart(12, "0");
    const kind = m.suiteLabel === "A11Y" ? "a11y" : "security";
    return {
        "Microsoft.VSTS.TCM.AutomationStatus": "Automated",
        "Microsoft.VSTS.TCM.AutomatedTestName": m.testName,
        "Microsoft.VSTS.TCM.AutomatedTestStorage": m.relPath,
        "Microsoft.VSTS.TCM.AutomatedTestId": `00000000-0000-0000-0000-${hexId}`,
        "Microsoft.VSTS.TCM.AutomatedTestType":
            m.suiteLabel === "A11Y" ? "E2E|accessibility" : "DAST|security",
        "System.Description": `Automated Playwright ${kind} test: ${m.relPath}`,
    };
}

async function main() {
    const mappings = [
        ...extractMappings(TST_E2E_ROOT, "A11Y"),
        ...extractMappings(TST_E2E_ROOT, "Security"),
    ];

    const byId = new Map(mappings.map((m) => [m.testCaseId, m]));
    console.log(`Found ${mappings.length} tagged test() blocks mapping to ADO test case ids.`);

    const ids = [...byId.keys()];
    const items = await getWorkItems(ids, AUTOMATION_FIELDS, PROJECT);
    const itemById = new Map(items.map((i: any) => [i.fields["System.Id"], i]));

    const missing = ids.filter((id) => !itemById.has(id));
    if (missing.length) console.warn(`WARN: no ADO work item found for tagged ids: ${missing.join(", ")}`);

    // Re-apply to every mapped id, including #8952 - its AutomatedTestName/
    // Storage still hold the generic placeholder from the very first single-
    // item write, before the real spec-tag mapping existed, so it's
    // inconsistent with the other 31 unless it's refreshed too. Idempotent
    // either way.
    const toUpdate = ids
        .map((id) => itemById.get(id))
        .filter((i: any): i is any => !!i);

    console.log(`${toUpdate.length} of ${ids.length} mapped test cases will be (re)applied.`);

    const targetList = ONLY_ONE ? toUpdate.slice(0, 1) : toUpdate;

    for (const item of targetList) {
        const id = item.fields["System.Id"];
        const title = item.fields["System.Title"];
        const mapping = byId.get(id)!;
        const fields = buildFields(mapping);

        if (DRY_RUN) {
            console.log(`[dry-run] would set #${id} "${title}" ->`, fields);
            continue;
        }
        try {
            await updateWorkItemFields(id, fields, PROJECT);
            console.log(`OK  #${id} "${title}" -> Automated  ${buildWorkItemUrl(id, PROJECT)}`);
        } catch (err: any) {
            console.error(`FAIL #${id} "${title}":`, err?.response?.status, err?.response?.data ?? err.message);
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
