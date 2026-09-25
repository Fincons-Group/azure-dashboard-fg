"""Create one ADO Test Case per entry in cases.json and add it to a static suite.

usage: import_cases.py (--suite 15077 | --plan 8475 --suite-name "<tab>") --tags "E2E; Plurifonds"
                       [--sheet "<tab>"] [--cases cases.json] [--state state.json]
                       [--source-project "Nuova Frontiera"] [--set-priority] [--dry] [--limit N]
--plan/--suite-name finds a static suite with that name under the plan root, creating it if missing.
--sheet limits the run to one Excel tab (use one run per tab when each tab has its own suite).
Idempotent: state.json maps case key -> created TC id; re-running skips done keys.
Run with --limit=1 first and check the created case before doing the rest.
"""
import argparse, html, os, sys
from ado import BASE, PROJECT, call, load_json, resolve_plan, save_json

ap = argparse.ArgumentParser()
ap.add_argument("--suite", type=int)
ap.add_argument("--plan", type=int)
ap.add_argument("--suite-name")
ap.add_argument("--sheet")
ap.add_argument("--source-project", default="Nuova Frontiera",
                help="project of the source_id work items (ADO-export Excel), linked in the description")
ap.add_argument("--tags", required=True, help='base tags, e.g. "E2E; Plurifonds"; the area is appended')
ap.add_argument("--cases", default="cases.json")
ap.add_argument("--state", default="state.json")
ap.add_argument("--source", default="", help="Excel file name, cited in the description")
ap.add_argument("--set-priority", action="store_true")
ap.add_argument("--dry", action="store_true")
ap.add_argument("--limit", type=int)
a = ap.parse_args()


def fmt(text):
    body = "<br/>".join(html.escape(l) for l in str(text or "").strip().splitlines())
    return html.escape(f"<DIV><P>{body}</P></DIV>")


def steps_xml(steps):
    parts = [f'<step id="{i}" type="ActionStep"><parameterizedString isformatted="true">{fmt(x)}</parameterizedString>'
             f'<parameterizedString isformatted="true">{fmt(e)}</parameterizedString><description/></step>'
             for i, (x, e) in enumerate(steps, start=2)]
    return f'<steps id="0" last="{len(steps) + 1}">' + "".join(parts) + "</steps>"


if a.suite:
    plan, plan_name = resolve_plan(a.suite)
elif a.plan and a.suite_name:
    plan = a.plan
    s, j = call("GET", f"{BASE}/{PROJECT}/_apis/testplan/plans/{plan}?api-version=7.1")
    if s != 200:
        sys.exit(f"plan {plan} not found: {s} {j}")
    plan_name, root = j["name"], j["rootSuite"]["id"]
    s, j = call("GET", f"{BASE}/{PROJECT}/_apis/testplan/Plans/{plan}/suites?asTreeView=false&api-version=7.1")
    hit = [x for x in j.get("value", []) if x["name"] == a.suite_name and x.get("parentSuite", {}).get("id") == root]
    if hit:
        a.suite = hit[0]["id"]
    elif a.dry:
        a.suite = 0
    else:
        s, j = call("POST", f"{BASE}/{PROJECT}/_apis/testplan/Plans/{plan}/suites?api-version=7.1",
                    {"suiteType": "staticTestSuite", "name": a.suite_name, "parentSuite": {"id": root}},
                    ctype="application/json")
        if s != 200:
            sys.exit(f"SUITE CREATE FAILED {s} {j}")
        a.suite = j["id"]
        print(f"created suite {a.suite} '{a.suite_name}'")
else:
    sys.exit("give --suite, or --plan with --suite-name")
print(f"suite {a.suite} -> plan {plan} ({plan_name})")
cases = [c for c in load_json(a.cases, []) if not a.sheet or c["sheet"] == a.sheet]
state = load_json(a.state, {})
done = 0
for c in cases:
    if c["key"] in state:
        continue
    if a.limit is not None and done >= a.limit:
        break
    src = f"Fonte: {html.escape(a.source)}, foglio {html.escape(c['sheet'])}, riga {c['row']}"
    if c.get("source_id"):
        sp = a.source_project.replace(" ", "%20")
        src += (f'<br/>Test case originale: <a href="{BASE}/{sp}/_workitems/edit/{c["source_id"]}">'
                f'{html.escape(a.source_project)} #{c["source_id"]}</a>')
    ops = [
        {"op": "add", "path": "/fields/System.Title", "value": c["title"]},
        {"op": "add", "path": "/fields/System.Description",
         "value": f"<div>{html.escape(c['desc'])}</div><div><br/>{src}</div>"},
        {"op": "add", "path": "/fields/Microsoft.VSTS.TCM.Steps", "value": steps_xml(c["steps"])},
        {"op": "add", "path": "/fields/System.Tags", "value": f"{a.tags}; {c['area']}"},
    ]
    if a.set_priority:
        ops.append({"op": "add", "path": "/fields/Microsoft.VSTS.Common.Priority", "value": c["priority"]})
    if a.dry:
        print("DRY", c["key"], len(c["steps"]), c["area"], "|", c["title"])
        done += 1
        continue
    s, j = call("POST", f"{BASE}/{PROJECT}/_apis/wit/workitems/$Test%20Case?api-version=7.1", ops)
    if s != 200:
        sys.exit(f"CREATE FAILED {c['key']} {s} {j}")
    wid = j["id"]
    # The newer testplan endpoint returns 200 but silently doesn't link in this org; use the old one.
    s2, j2 = call("POST", f"{BASE}/{PROJECT}/_apis/test/plans/{plan}/suites/{a.suite}/testcases/{wid}?api-version=5.0",
                  ctype="application/json")
    linked = s2 == 200 and isinstance(j2, dict) and j2.get("count", 0) > 0
    state[c["key"]] = {"id": wid, "linked": linked}
    save_json(a.state, state)
    print(c["key"], "->", wid, "linked" if linked else f"LINK FAILED {s2} {j2}", "|", c["title"])
    done += 1

s, j = call("GET", f"{BASE}/{PROJECT}/_apis/testplan/Plans/{plan}/Suites/{a.suite}/TestCase?api-version=7.1") if a.suite else (0, {})
print(f"processed {done}; state {sum(1 for c in cases if c['key'] in state)}/{len(cases)}; suite now holds {j.get('count') if isinstance(j, dict) else '?'} cases")
