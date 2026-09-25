"""Shared ADO helpers: credentials, REST calls, plan lookup.

Credentials (first match wins):
  1. environment variables AZDO_PAT and AZDO_ORG
  2. the .env file named by ADO_ENV_FILE
  3. a .env file in the current directory or any parent
  4. the .env at the root of the repo this skill lives in (skills/<name>/scripts -> repo root)
The project defaults to "Test Factory"; override it with ADO_PROJECT.
"""
import json, os, sys, urllib.error, urllib.parse, urllib.request
from base64 import b64encode
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")


def _read_env_file(path):
    env = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def _candidate_env_files():
    if os.environ.get("ADO_ENV_FILE"):
        yield Path(os.environ["ADO_ENV_FILE"])
    cwd = Path.cwd().resolve()
    for d in [cwd, *cwd.parents]:
        yield d / ".env"
    yield Path(__file__).resolve().parents[3] / ".env"


def _credentials():
    if os.environ.get("AZDO_PAT") and os.environ.get("AZDO_ORG"):
        return os.environ["AZDO_PAT"], os.environ["AZDO_ORG"]
    for f in _candidate_env_files():
        if f.is_file():
            env = _read_env_file(f)
            if env.get("AZDO_PAT") and env.get("AZDO_ORG"):
                return env["AZDO_PAT"], env["AZDO_ORG"]
    sys.exit("AZDO_PAT/AZDO_ORG not found: set them as environment variables, or point ADO_ENV_FILE at a .env file")


_pat, ORG = _credentials()
BASE = f"https://dev.azure.com/{ORG}"
PROJECT = urllib.parse.quote(os.environ.get("ADO_PROJECT", "Test Factory"))
_AUTH = "Basic " + b64encode((":" + _pat).encode()).decode()


def call(method, url, body=None, ctype="application/json-patch+json"):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Authorization": _AUTH, "Content-Type": ctype})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")


def get_item(wid, expand=None):
    q = f"&$expand={expand}" if expand else ""
    s, j = call("GET", f"{BASE}/_apis/wit/workitems/{wid}?api-version=7.1{q}")
    if s != 200:
        sys.exit(f"GET work item {wid} failed: {s} {j}")
    return j


def resolve_plan(suite_id, project=PROJECT):
    """Find the plan that owns the suite by asking each plan in the project for it."""
    _, j = call("GET", f"{BASE}/{project}/_apis/testplan/plans?api-version=7.1")
    for p in j.get("value", []):
        s2, _ = call("GET", f"{BASE}/{project}/_apis/testplan/Plans/{p['id']}/suites/{suite_id}?api-version=7.1")
        if s2 == 200:
            return p["id"], p["name"]
    sys.exit(f"No plan in {project} contains suite {suite_id}")


def load_json(path, default):
    return json.load(open(path, encoding="utf-8")) if os.path.exists(path) else default


def save_json(path, data):
    json.dump(data, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
