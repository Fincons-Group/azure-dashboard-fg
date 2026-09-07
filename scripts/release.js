// Automates the release process end to end:
//   1. picks patch/minor/major from the Conventional Commits since the last tag
//   2. bumps the root package.json version
//   3. commits and pushes that bump to main
//   4. creates and pushes the vX.Y.Z tag
// Pushing the tag is what triggers publish-package.yml (npm publish) and
// deploy-pages.yml (GitHub Pages deploy) - see .github/workflows/.
//
// Usage:
//   npm run release                  # auto-detect bump from commit messages
//   npm run release -- minor         # force a minor bump (0.1.0 -> 0.2.0)
//   npm run release -- major         # force a major bump (0.1.0 -> 1.0.0)
//   npm run release -- patch         # force a patch bump
//   npm run release -- 1.4.2         # explicit version
//   npm run release -- --yes         # skip the confirmation prompt

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

const args = process.argv.slice(2);
const yes = args.includes("--yes") || args.includes("-y");
const bump = args.find((a) => a !== "--yes" && a !== "-y") ?? "auto";

// On Windows, npm/npx/gh-adjacent CLIs installed via the standard installer
// are .cmd shims rather than .exe files, which execFileSync can't launch
// directly without a shell (spawnSync ENOENT).
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

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

run(npmCommand, ["version", resolvedBump, "--no-git-tag-version"], {
    silent: true,
    shell: process.platform === "win32",
});

const after = JSON.parse(readFileSync("package.json", "utf8")).version;
const tag = `v${after}`;

const existingTags = runCapture("git", ["tag", "-l", tag]);
if (existingTags !== "") {
    run("git", ["checkout", "--", "package.json", "package-lock.json"]);
    fail(`tag ${tag} already exists`);
}

console.log(`New version:     ${after}`);
const proceed = await confirm(
    `\nThis will commit the bump, push to main, then push tag ${tag} (triggering npm publish + GitHub Pages deploy). Continue?`
);
if (!proceed) {
    run("git", ["checkout", "--", "package.json", "package-lock.json"]);
    fail("cancelled");
}

// --- commit, tag, push -------------------------------------------------------

run("git", ["add", "package.json", "package-lock.json"]);
run("git", ["commit", "-m", `chore(release): ${tag}`]);

console.log("\nPushing release commit to main...");
try {
    run("git", ["push", "origin", "main"]);
} catch {
    fail(
        "push to main was rejected (branch protection?) - the release commit is still local on main; " +
            "push it via a PR, then re-run to just create/push the tag"
    );
}

run("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);

console.log(`Pushing tag ${tag}...`);
try {
    run("git", ["push", "origin", tag]);
} catch {
    fail(`main was updated but pushing tag ${tag} failed - push it manually with: git push origin ${tag}`);
}

// --- optional GitHub release notes ------------------------------------------

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
