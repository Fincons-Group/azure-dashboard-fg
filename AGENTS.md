# Agent instructions

## Skills

Reusable, tool-neutral workflows live in [`skills/`](skills/). When a request matches a skill's
description, read its `SKILL.md` and follow it.

| Skill | Use when |
|---|---|
| [`ado-excel-testcase-import`](skills/ado-excel-testcase-import/SKILL.md) | Someone hands over a test-case Excel (.xlsx) and a plan/suite id and wants Azure DevOps Test Cases created in Test Factory: one static suite per tab, an optional colour filter such as "title in yellow", and optional Epics with `feature/...` Issues. |

## Repo rules
- Never commit `.env`.
