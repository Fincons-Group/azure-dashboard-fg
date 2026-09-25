# ado-excel-testcase-import

An AI-assistant skill that turns a test-case Excel into Azure DevOps Test Cases in **Test Factory**:
- one static suite per tab (or a given suite), with an optional colour filter such as "title filled in yellow"
- optionally, one Epic per tab with a `feature/<prefix>-<tcId>-<slug>` Issue per Test Case

The instructions are in [`SKILL.md`](SKILL.md) and the scripts are in [`scripts/`](scripts/).

## Setup
1. Install Python 3.10+ and run `pip install openpyxl`.
2. Provide an Azure DevOps PAT with Work Items and Test Management read/write, using either option:
   - environment variables `AZDO_PAT` and `AZDO_ORG`, or
   - a `.env` file containing them. The scripts look for it in this order: `ADO_ENV_FILE`, the current
     folder and its parents, then this repo's root.
3. Optional: set `ADO_PROJECT` if the target is not `Test Factory`.

## How each assistant finds it
Inside this repo, every supported assistant already points at `SKILL.md`:

| Assistant | Entry point in this repo |
|---|---|
| Claude Code | `.claude/skills/ado-excel-testcase-import/SKILL.md` (project skill) |
| OpenAI Codex, and other tools that read `AGENTS.md` | `AGENTS.md` |
| GitHub Copilot (VS Code / Copilot agent) | `.github/copilot-instructions.md` and `AGENTS.md` |
| Gemini CLI | `GEMINI.md` |

Ask in plain words, for example: *"import the test cases from `<file>.xlsx` into plan 8475, one suite
per tab, only titles filled in yellow"*.

## Using it outside this repo
The skill ships in the npm package (`@fincons-group/azure-dashboard`, folder `skills/`). You can also
copy the folder from a clone. Then point your assistant at it:
- **Claude Code:** copy `skills/ado-excel-testcase-import/` to `~/.claude/skills/ado-excel-testcase-import/`.
- **Codex / Copilot / Gemini:** add a line to your global `AGENTS.md` / `GEMINI.md` / Copilot
  instructions: "When asked to import a test-case Excel into Azure DevOps, follow
  `<path>/ado-excel-testcase-import/SKILL.md`."

## Example
```
python scripts/parse_excel.py cases.xlsx --colors
python scripts/parse_excel.py cases.xlsx --fill FFFFFF00 --title-fill --out cases.json
python scripts/import_cases.py --plan 8475 --suite-name "Censimento anagrafica" \
    --sheet "Censimento anagrafica" --tags "E2E; FrontOfficeAuto" --source cases.xlsx --limit 1
```
