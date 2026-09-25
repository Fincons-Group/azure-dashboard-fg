---
name: ado-excel-testcase-import
description: Import a test-case Excel (ALM "Pacchetto" export or ADO query export) into Azure DevOps Test Factory, one static suite per tab or into a given suite, optionally filtered by cell colour. Then, optionally, create one Epic per tab with one feature/<prefix>-<tcId>-<slug> Issue per Test Case, named after the tst-e2e spec convention. Use when someone hands over a test-case .xlsx with a plan/suite id (and maybe Epic ids) and wants the test cases and feature Issues created.
---

# Excel test cases -> ADO suite (+ optional Epics and feature Issues)

This file is the single source of truth. Claude, Codex, Copilot and Gemini all reach it through the
pointer files described in `README.md` next to it.

**Requirements:** Python 3.10+ with `openpyxl` (`pip install openpyxl`). You also need an Azure DevOps
PAT with Work Items and Test Management read/write. Credentials come from `AZDO_PAT`/`AZDO_ORG`
environment variables, an `ADO_ENV_FILE`, or the repo's `.env` (see `scripts/ado.py`). The target
project is **Test Factory** unless `ADO_PROJECT` is set.

The scripts are in `scripts/` next to this file. Run them from a scratch working folder, never from
inside the repo: they write `cases.json`, `state.json`, `slugs.json` and `epics_state.json` there, and
re-running a script skips anything already created.

## 1. Collect inputs (ask for whatever is missing, in one question)
- The Excel path.
- **Filter.** If the user didn't mention one, ask whether to take all cases or filter, for example by
  cell colour. Run `parse_excel.py <xlsx> --colors` first so the question lists the colours that
  actually exist and how many cases each touches. "Title filled in yellow" means
  `--fill FFFFFF00 --title-fill`.
- **Target**, one of:
  - a **suite id** (the plan is resolved automatically), or
  - a **plan id**, where each Excel tab becomes a static suite named after the tab under the plan
    root. Use `--plan <id> --suite-name "<tab>" --sheet "<tab>"`, one run per tab; the suite is created
    if missing, and a tab with no cases left after the filter gets no suite.
- **Epics.** These are optional; skip step 4 if the user says no Epics or children for now. Otherwise
  create one Epic per Excel tab, which is the final split. Ask for existing Epic ids to reuse (they
  get renamed and tagged) and create the rest. Split by area only if the user asks.
- **Tags** (e.g. `E2E; Plurifonds`, `E2E; FrontOfficeAuto`) and the **spec prefix** (`e2e` or `nrt`;
  confirm with the user).

## 2. Parse and present (nothing is created yet)
`python scripts/parse_excel.py <xlsx> [--sheets ...] [--fill FFFFFF00 [--title-fill]] --out cases.json`
- Two layouts are auto-detected:
  - ALM "Pacchetto" export: col A = "Test Case", B = title, C/D/E = step no/action/expected, I = description.
  - ADO query export: a header row `ID | Work Item Type | Title | Test Step | Step Action | Step Expected | ...`.
    The original work item id is kept and linked from the new case (`--source-project`, default
    "Nuova Frontiera"), and the tab name becomes the area.
- Area = the title prefix before " - " (spelling variants are unified), or the tab for ADO exports.
- Suggested priority from step count: 5+ = P1, 3-4 = P2, 2 = P3, 1 = P4. It is only a suggestion.

Show the user one table per tab (priority, steps, title, proposed names) and get an OK before creating.

## 3. Import the Test Cases
```
python scripts/import_cases.py (--suite <id> | --plan <id> --suite-name "<tab>" --sheet "<tab>") \
    --tags "<tags>" --source "<xlsx file name>" --limit 1
```
Open the one created case in ADO and check its title, steps, tags and description, then run the same
command again without `--limit`. The script prints the final suite count, which must match the case
count. Add `--set-priority` only if the user wants the Priority field filled.

## 4. Epics + feature Issues (optional)
Write `slugs.json` as `{ "<sheet>!<row>": "<slug>" }`. Slug rules:
- short kebab-case, ASCII only
- **never include the app name** (the spec folder already carries it, e.g. `plurifonds/`)
- a descriptive slug (`comparto-scelta-versamento`), the functional code (`nf-cens-004`), or both
  (`cens-004-barra-avanzamento-wizard`), whichever the team picked
- **Code when available** (`--code-when-available`): the name is the title's functional code, in
  lower case and **without the TC id**. `NF-CENS-035 - ...` gives `feature/nrt-nf-cens-035` and
  `nrt-nf-cens-035-fe.spec.ts`. Cases without a code become `<prefix>-<slug>`, so only they need an
  entry in `slugs.json`.

Write `epics.json` as `[{"title": "E2E - <tab>", "sheets": ["<tab>"], "existing": <id, optional>}]` and
confirm the titles, then run:
`python scripts/create_epics.py --epics epics.json --slugs slugs.json --tags "<tags>" --prefix <e2e|nrt> [--code-when-available]`
- Each Issue is of type **Issue** and titled `feature/<prefix>-<tcId>-<slug>`. Its parent is the Epic,
  it has a Tested By link to the TC, and its description links the TC and names the spec
  `<prefix>-<tcId>-<slug>-fe.spec.ts`.
- Renamed and new Epics both get the tags. The Epic description gets a feature table with the
  suggested priority marked **optional**. The Priority field is set only with `--set-priority`.

## 5. Report
Give one table per tab or Epic listing TC id, title, feature and spec file. Also report the created
suite/Epic ids and any renamed Epic's old title.

## Naming (tst-e2e)
The active lint rule is `*-@(fe|a11y).spec`, so specs must end with `-fe.spec.ts`. The commented-out
`nrt-<domain>` rule with codes like `vit` is outdated.

## ADO gotchas (org ItasMutua)
- Adding a case to a suite: the newer `testplan/.../TestCase` POST returns 200 but does nothing in this
  org. Use the old `test/plans/{p}/suites/{s}/testcases/{id}` endpoint (the scripts already do).
- Don't set `AutomationStatus` at creation (it is rejected).
- Test Cases can't be deleted with the generic work-item DELETE, and the test DELETE usually returns 403.
  To undo, unlink the case from the suite and set it to Closed with a `[NON UTILIZZATO]` title prefix.
- If the Excel layout is neither of the two above, inspect a few rows and adapt the column mapping
  in `parse_excel.py` before parsing.
