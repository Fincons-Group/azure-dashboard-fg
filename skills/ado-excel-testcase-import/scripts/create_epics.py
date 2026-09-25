"""Create (or rename) one Epic per group and one feature Issue per imported Test Case under it.

usage: create_epics.py --epics epics.json --slugs slugs.json --tags "E2E; FrontOfficeAuto"
                       [--cases cases.json] [--state state.json] [--epic-state epics_state.json]
                       [--prefix e2e] [--code-when-available] [--set-priority]

epics.json: [{"title": "E2E - <tab name>", "sheets": ["TabName"], "existing": 13856 (optional)}, ...]
            A group may use "areas": [...] instead of "sheets" (only if the user asks for an area split).
slugs.json: {"<sheet>!<row>": "area-capability-kebab", ...}. Written by Claude. It never includes the
            app name, because the spec folder already carries it.
--code-when-available: if the title starts with a functional code ("NF-CENS-035 - ..."), use the code
            as-is instead of the slug (feature/nrt-15200-NF-CENS-035). Cases without a code still need a slug.
Names: Issue title  feature/<prefix>-<tcId>-<slug>
       spec file    <prefix>-<tcId>-<slug>-fe.spec.ts
The Epic description gets a table of its features with a suggested priority marked optional.
The Priority field is only set with --set-priority.
"""
import argparse, html, re, sys
from ado import BASE, PROJECT, call, get_item, load_json, save_json

ap = argparse.ArgumentParser()
ap.add_argument("--epics", required=True)
ap.add_argument("--slugs", default="slugs.json")
ap.add_argument("--code-when-available", action="store_true",
                help="use the title's functional code (e.g. NF-CENS-035) instead of the slug when present")
ap.add_argument("--tags", required=True)
ap.add_argument("--cases", default="cases.json")
ap.add_argument("--state", default="state.json")
ap.add_argument("--epic-state", default="epics_state.json")
ap.add_argument("--prefix", default="e2e")
ap.add_argument("--set-priority", action="store_true")
a = ap.parse_args()

cases = {c["key"]: c for c in load_json(a.cases, [])}
tcs = load_json(a.state, {})
slugs = load_json(a.slugs, {})
st = load_json(a.epic_state, {"epics": {}, "issues": {}})
CODE = re.compile(r"^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)\s+-\s+")


def name_part(c):
    m = CODE.match(c["title"]) if a.code_when_available else None
    return m.group(1) if m else slugs.get(c["key"])


missing = [k for k, c in cases.items() if k in tcs and not name_part(c)]
if missing:
    sys.exit(f"slugs.json is missing keys: {missing}")

for grp in load_json(a.epics, []):
    title = grp["title"]
    members = [c for k, c in cases.items() if k in tcs and (
        c["sheet"] in grp.get("sheets", []) or c["area"] in grp.get("areas", []))]
    order = grp.get("areas") or []
    members.sort(key=lambda c: (order.index(c["area"]) if c["area"] in order else 0,
                                c["priority"], -len(c["steps"]), c["sheet"], c["row"]))
    epic = st["epics"].get(title)
    if epic is None:
        base = [{"op": "add", "path": "/fields/System.Title", "value": title},
                {"op": "add", "path": "/fields/System.Tags", "value": a.tags}]
        if grp.get("existing"):
            s, j = call("PATCH", f"{BASE}/_apis/wit/workitems/{grp['existing']}?api-version=7.1", base)
        else:
            s, j = call("POST", f"{BASE}/{PROJECT}/_apis/wit/workitems/$Epic?api-version=7.1", base)
        if s != 200:
            sys.exit(f"EPIC FAILED {title}: {s} {j}")
        epic = st["epics"][title] = j["id"]
        save_json(a.epic_state, st)
    print(f"Epic {epic}: {title} ({len(members)} features)")

    rows = []
    for c in members:
        tc = tcs[c["key"]]["id"]
        name = f"{a.prefix}-{tc}-{name_part(c)}"
        feature, spec = f"feature/{name}", f"{name}-fe.spec.ts"
        if str(tc) not in st["issues"]:
            tc_url = f"{BASE}/{PROJECT}/_workitems/edit/{tc}"
            ops = [
                {"op": "add", "path": "/fields/System.Title", "value": feature},
                {"op": "add", "path": "/fields/System.Description",
                 "value": f'<div>Automazione del Test Case <a href="{tc_url}">{tc} - {html.escape(c["title"])}</a></div>'
                          f"<div>Spec: <code>{spec}</code></div>"},
                {"op": "add", "path": "/fields/System.Tags", "value": f"{a.tags}; {c['area']}"},
                {"op": "add", "path": "/relations/-", "value": {
                    "rel": "System.LinkTypes.Hierarchy-Reverse", "url": f"{BASE}/_apis/wit/workItems/{epic}"}},
            ]
            if a.set_priority:
                ops.append({"op": "add", "path": "/fields/Microsoft.VSTS.Common.Priority", "value": c["priority"]})
            tested_by = {"op": "add", "path": "/relations/-", "value": {
                "rel": "Microsoft.VSTS.Common.TestedBy-Forward", "url": f"{BASE}/_apis/wit/workItems/{tc}"}}
            url = f"{BASE}/{PROJECT}/_apis/wit/workitems/$Issue?api-version=7.1"
            s, j = call("POST", url, ops + [tested_by])
            if s != 200:
                s, j = call("POST", url, ops)
            if s != 200:
                sys.exit(f"ISSUE FAILED tc {tc}: {s} {j}")
            st["issues"][str(tc)] = {"issue": j["id"], "epic": epic, "feature": feature, "spec": spec}
            save_json(a.epic_state, st)
            print(f"  {j['id']} {feature}")
        rows.append((c, tc, st["issues"][str(tc)]["issue"], feature))

    table = "".join(
        f"<tr><td>{html.escape(c['area'])}</td><td>{tc}</td><td>{iss}</td><td>{html.escape(f)}</td>"
        f"<td>{len(c['steps'])}</td><td>P{c['priority']}</td></tr>" for c, tc, iss, f in rows)
    block = ("<div><b>Feature</b> (priorità suggerita in base al numero di step: opzionale, "
             "5+ step = P1, 3-4 = P2, 2 = P3, 1 = P4)</div>"
             "<table><tr><th>Area</th><th>Test Case</th><th>Issue</th><th>Feature</th><th>Step</th>"
             f"<th>Priorità (opz.)</th></tr>{table}</table>")
    old = get_item(epic)["fields"].get("System.Description") or ""
    marker = "<!--feature-table-->"
    keep = old.split(marker)[0] if marker in old else old
    call("PATCH", f"{BASE}/_apis/wit/workitems/{epic}?api-version=7.1",
         [{"op": "add", "path": "/fields/System.Description", "value": keep + marker + block}])
    kids = [r for r in get_item(epic, "relations").get("relations") or [] if r["rel"] == "System.LinkTypes.Hierarchy-Forward"]
    print(f"  epic {epic} now has {len(kids)} children")
print("issues total:", len(st["issues"]))
