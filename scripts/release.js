// Automates the release process end to end:
//   1. picks patch/minor/major from the Conventional Commits since the last tag
//   2. bumps the root package.json version on a release/vX.Y.Z branch
//   3. opens a PR into main, waits for required checks, and merges it
//      (main requires a PR - see .github/workflows/configure-branch-protection.yml)
//   4. creates and pushes the vX.Y.Z tag
// Pushing the tag is what triggers publish-package.yml (npm publish) and
// deploy-pages.yml (GitHub Pages deploy) - see .github/workflows/.
//
// Requires the "gh" CLI, authenticated for this repo's GitHub host.
//
// Usage:
//   npm run release                  # auto-detect bump from commit messages
//   npm run release -- minor         # force a minor bump (0.1.0 -> 0.2.0)
//   npm run release -- major         # force a major bump (0.1.0 -> 1.0.0)
//   npm run release -- patch         # force a patch bump
//   npm run release -- 1.4.2         # explicit version
//   npm run release -- --yes         # skip the confirmation prompt
//
//   npm run release -- --tag-only    # main already has the version bump
//                                     # (e.g. you merged the release PR by
//                                     # hand) - just tag current main HEAD
//                                     # and push, skipping the branch/PR/merge

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

const args = process.argv.slice(2);
const yes = args.includes("--yes") || args.includes("-y");
const tagOnly = args.includes("--tag-only");
const bump = args.find((a) => a !== "--yes" && a !== "-y" && a !== "--tag-only") ?? "auto";

// On Windows, npm/npx/gh-adjacent CLIs installed via the standard installer
// are .cmd shims rather than .exe files, which execFileSync can't launch
// directly without a shell (spawnSync ENOENT/EINVAL).
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const winShell = process.platform === "win32";

function run(command, cmdArgs, options = {}) {
    return execFileSync(command, cmdArgs, {
        encoding: "utf8",
        stdio: options.silent ? ["ignore", "pipe", "pipe"] : "inherit",
        ...options,
    });
}

function runCapture(command, cmdArgs, options = {}) {
    return execFileSync(command, cmdArgs, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", options.quiet ? "ignore" : "pipe"],
        ...options,
    }).trim();
}

function fail(message) {
    console.error(`\nRelease aborted: ${message}`);
    process.exit(1);
}

async function confirm(question) {
    if (yes) return true;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`${question} [y/N] `);
    rl.close();
    return /^y(es)?$/i.test(answer.trim());
}

// Inspects Conventional Commit messages since the last vX.Y.Z tag to decide
// the bump: any "BREAKING CHANGE:" footer or "type!:" header -> major, any
// "feat:" -> minor, otherwise (fix/chore/refactor/etc.) -> patch.
function detectBump() {
    let lastTag = "";
    try {
        lastTag = runCapture("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"], { quiet: true });
    } catch {
        // no previous tag - this is the first release, consider full history
    }

    const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
    const log = runCapture("git", ["log", range, "--pretty=format:%B\x1e"]);
    const commits = log
        .split("\x1e")
        .map((c) => c.trim())
        .filter(Boolean);

    if (commits.length === 0) {
        return { type: null, lastTag, commits: [] };
    }

    let type = "patch";
    for (const commit of commits) {
        const header = commit.split("\n")[0];
        const match = header.match(/^(\w+)(\([^)]*\))?(!)?:\s/);
        const isBreaking = /^BREAKING CHANGE:/m.test(commit) || (match && match[3] === "!");
        if (isBreaking) {
            type = "major";
            break;
        }
        if (match && match[1] === "feat" && type !== "major") {
            type = "minor";
        }
    }

    return { type, lastTag, commits };
}

function tagAndPublish(tag) {
    const existingTags = runCapture("git", ["tag", "-l", tag]);
    if (existingTags !== "") {
        fail(`tag ${tag} already exists`);
    }

    run("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);

    console.log(`Pushing tag ${tag}...`);
    try {
        run("git", ["push", "origin", tag]);
    } catch {
        fail(`pushing tag ${tag} failed - push it manually with: git push origin ${tag}`);
    }

    try {
        run("gh", ["release", "create", tag, "--title", tag, "--generate-notes"], { silent: true });
        console.log(`\nGitHub release ${tag} created.`);
    } catch {
        console.log(
            `\n(skipped creating a GitHub release - "gh" isn't available/authenticated for this repo's host; ` +
                "the tag push already triggered the publish and deploy workflows)"
        );
    }

    console.log(
        `\nDone. ${tag} is pushed - check the Actions tab for the "Publish package" and "Deploy to GitHub Pages" runs.`
    );
}

// --- preflight -------------------------------------------------------------

if (!["auto", "patch", "minor", "major"].includes(bump) && !/^\d+\.\d+\.\d+$/.test(bump)) {
    fail(`invalid version argument "${bump}" (expected auto, patch, minor, major, or X.Y.Z)`);
}

const status = runCapture("git", ["status", "--porcelain"]);
if (status !== "") {
    fail("working tree is not clean - commit or stash your changes first");
}

console.log("Fetching origin/main...");
run("git", ["fetch", "origin", "main"], { silent: true });

const currentBranch = runCapture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (currentBranch !== "main") {
    console.log(`Switching from "${currentBranch}" to main...`);
    try {
        run("git", ["checkout", "main"]);
    } catch {
        fail('could not switch to main - check it out manually and re-run');
    }
}

try {
    run("git", ["merge", "--ff-only", "origin/main"]);
} catch {
    fail("local main has diverged from origin/main - reconcile manually and re-run");
}

// --- --tag-only: main already has the bump, just tag it --------------------

if (tagOnly) {
    const version = JSON.parse(readFileSync("package.json", "utf8")).version;
    const tag = `v${version}`;
    console.log(`\nmain is at version ${version}.`);
    const proceed = await confirm(`Tag current main HEAD as ${tag} and push it (triggers npm publish + GitHub Pages deploy)?`);
    if (!proceed) fail("cancelled");
    tagAndPublish(tag);
    process.exit(0);
}

// --- version bump ------------------------------------------------------------

const before = JSON.parse(readFileSync("package.json", "utf8")).version;
console.log(`\nCurrent version: ${before}`);

let resolvedBump = bump;
if (bump === "auto") {
    const detected = detectBump();
    if (detected.type === null) {
        fail(
            detected.lastTag
                ? `no commits since ${detected.lastTag} - nothing to release`
                : "no commits found - nothing to release"
        );
    }
    resolvedBump = detected.type;
    console.log(
        detected.lastTag
            ? `\nCommits since ${detected.lastTag}:`
            : "\nCommits (no previous release tag found):"
    );
    for (const commit of detected.commits) {
        console.log(`  - ${commit.split("\n")[0]}`);
    }
    console.log(`Detected bump: ${resolvedBump}`);
}

run(npmCommand, ["version", resolvedBump, "--no-git-tag-version"], { silent: true, shell: winShell });

const after = JSON.parse(readFileSync("package.json", "utf8")).version;
const tag = `v${after}`;
const branchName = `release/${tag}`;

const existingTags = runCapture("git", ["tag", "-l", tag]);
if (existingTags !== "") {
    run("git", ["checkout", "--", "package.json", "package-lock.json"]);
    fail(`tag ${tag} already exists`);
}

console.log(`New version:     ${after}`);
const proceed = await confirm(
    `\nThis will open branch "${branchName}", PR it into main, wait for checks, merge, then push tag ${tag} ` +
        "(triggering npm publish + GitHub Pages deploy). Continue?"
);
if (!proceed) {
    run("git", ["checkout", "--", "package.json", "package-lock.json"]);
    fail("cancelled");
}

// --- branch, commit, PR, merge -----------------------------------------------

run("git", ["checkout", "-b", branchName]);
run("git", ["add", "package.json", "package-lock.json"]);
run("git", ["commit", "-m", `chore(release): ${tag}`]);

console.log(`\nPushing ${branchName}...`);
run("git", ["push", "-u", "origin", branchName]);

console.log("Opening PR...");
let prNumber;
try {
    run("gh", [
        "pr",
        "create",
        "--base",
        "main",
        "--title",
        `chore(release): ${tag}`,
        "--body",
        `Automated release PR: ${before} -> ${after}.`,
    ]);
    prNumber = runCapture("gh", ["pr", "view", "--json", "number", "--jq", ".number"]);
} catch {
    fail(
        `could not open a PR automatically - "${branchName}" is pushed, open a PR into main and merge it by hand, ` +
            `then run: npm run release -- --tag-only`
    );
}

console.log(`\nWaiting for required checks on PR #${prNumber}...`);
try {
    run("gh", ["pr", "checks", String(prNumber), "--watch"]);
} catch {
    fail(
        `checks failed (or didn't complete) for PR #${prNumber} - review it on GitHub. Once it's merged, run: ` +
            `npm run release -- --tag-only`
    );
}

console.log(`Merging PR #${prNumber}...`);
try {
    run("gh", ["pr", "merge", String(prNumber), "--squash", "--delete-branch", "--subject", `chore(release): ${tag}`]);
} catch {
    fail(`merge failed for PR #${prNumber} - merge it manually on GitHub, then run: npm run release -- --tag-only`);
}

run("git", ["checkout", "main"]);
try {
    run("git", ["pull", "--ff-only", "origin", "main"]);
} catch {
    fail(`PR #${prNumber} merged, but syncing local main failed - run "git pull" then: npm run release -- --tag-only`);
}

// --- tag, push, publish -------------------------------------------------------

tagAndPublish(tag);
