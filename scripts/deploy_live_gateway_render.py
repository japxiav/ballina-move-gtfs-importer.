"""Agent deployment helper. Credentials only from secure environment bindings."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.render.com/v1"
REPO = "https://github.com/japxiav/ballina-move-gtfs-importer."
BRANCH = "ops/live-gateway-hosting"
NAME = "ballina-move-live"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise ValueError("Deployment API redirect refused.")


def request(path, key, body=None):
    if not isinstance(key, str) or not key or len(key) > 512 or any(ord(c) < 33 or ord(c) > 126 for c in key):
        raise ValueError("Invalid secure Render binding.")
    headers = {"Authorization": "Bearer " + key, "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(API + path, headers=headers, data=data)
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=15) as response:
            raw = response.read(1_048_577)
    except urllib.error.HTTPError as error:
        raise ValueError(f"Render API returned HTTP {error.code}; no credential or response body logged.") from None
    if len(raw) > 1_048_576:
        raise ValueError("Deployment API response exceeded limit.")
    return json.loads(raw)


def service_payload(owner):
    return {"type": "web_service", "name": NAME, "ownerId": owner,
            "repo": REPO, "branch": BRANCH, "autoDeployTrigger": "off",
            "envVars": [{"key": "BALLINA_PREVIEW_PORT", "value": "10000"}],
            "serviceDetails": {"runtime": "docker", "plan": "free", "region": "frankfurt",
                               "numInstances": 1, "healthCheckPath": "/",
                               "envSpecificDetails": {"dockerfilePath": "./web/Dockerfile", "dockerContext": "."}}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--create", action="store_true", help="Create the explicitly authorized free read-only service.")
    args = parser.parse_args()
    key = os.environ.get("RENDER_API_KEY")
    if not key:
        raise ValueError("RENDER_API_KEY is missing; connect Render through secure environment settings.")
    entries = request("/owners?limit=100", key)
    owners = [entry.get("owner", entry) for entry in entries] if isinstance(entries, list) else []
    owners = [o for o in owners if isinstance(o, dict) and isinstance(o.get("id"), str)]
    selected = os.environ.get("BALLINA_RENDER_OWNER_ID")
    if not selected and len(owners) == 1:
        selected = owners[0]["id"]
    if selected not in {o["id"] for o in owners}:
        print(json.dumps({"availableWorkspaces": [{"id": o["id"], "name": o.get("name")} for o in owners]}))
        raise ValueError("Choose BALLINA_RENDER_OWNER_ID; no workspace was changed.")
    payload = service_payload(selected)
    if not args.create:
        print(json.dumps({"authorizedTarget": NAME, "plan": "free", "workspace": selected, "willCreate": False}))
        return
    root = Path(__file__).resolve().parents[1]
    def git(*arguments):
        return subprocess.check_output(["git", *arguments], cwd=root, text=True).strip()
    if git("branch", "--show-current") != BRANCH or git("status", "--porcelain"):
        raise ValueError("Deployment requires the clean reviewed hosting branch.")
    head = git("rev-parse", "HEAD")
    if git("ls-remote", "origin", "refs/heads/" + BRANCH).split()[0] != head:
        raise ValueError("Local and remotely reviewed deployment sources differ.")
    existing = request("/services?" + urllib.parse.urlencode({"name": NAME, "ownerId": selected, "limit": 100}), key)
    if not isinstance(existing, list):
        raise ValueError("Unexpected deployment API schema.")
    if existing:
        raise ValueError("A service with this name already exists; inspect before modifying or duplicating it.")
    result = request("/services", key, payload)
    if not isinstance(result, dict):
        raise ValueError("Unexpected create response; inspect Render before retrying.")
    service = result.get("service", result)
    if not isinstance(service, dict) or not isinstance(service.get("serviceDetails", {}), dict):
        raise ValueError("Unexpected created service schema; inspect Render before retrying.")
    url = service.get("serviceDetails", {}).get("url")
    if url:
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != "https" or not parsed.hostname or not parsed.hostname.endswith(".onrender.com") or parsed.username or parsed.password:
            print(json.dumps({"serviceId": service.get("id"), "created": True, "urlVerified": False}))
            raise ValueError("Unexpected deployment URL; inspect the created service before retrying.")
    print(json.dumps({"serviceId": service.get("id"), "url": url, "sourceCommit": head,
                      "plan": "free", "created": True, "browserVerificationRequired": True}))


if __name__ == "__main__":
    try:
        main()
    except json.JSONDecodeError:
        print("Invalid deployment API JSON; no response body logged.")
        raise SystemExit(1)
    except OSError:
        print("Deployment API network failure; no headers or response body logged.")
        raise SystemExit(1)
    except ValueError as error:
        print(str(error))
        raise SystemExit(1)
