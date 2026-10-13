"""Create once, verify actual Render deployment, then run the browser smoke."""
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.parse

import deploy_live_gateway_render as api


def verified_service(service, service_id):
    if not isinstance(service, dict) or not isinstance(service.get("serviceDetails"), dict):
        raise ValueError("Unexpected hosted service schema.")
    details = service["serviceDetails"]
    if (service.get("id") != service_id or service.get("name") != api.NAME or service.get("type") != "web_service"
        or str(service.get("repo", "")).removesuffix(".git").rstrip("/") != api.REPO
        or service.get("branch") != api.BRANCH or details.get("runtime") != "docker"
        or details.get("plan") != "free" or details.get("numInstances") != 1
        or service.get("autoDeployTrigger", "off" if service.get("autoDeploy") == "no" else None) != "off"):
        raise ValueError("Hosted service does not match the reviewed free target.")
    url = details.get("url")
    if not isinstance(url, str):
        raise ValueError("Hosted service has no verified URL.")
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or not parsed.hostname.endswith(".onrender.com") or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.port not in {None, 443}:
        raise ValueError("Unexpected hosted service URL.")
    return url.rstrip("/") + "/"


def live_commit(deploys, expected):
    if not isinstance(deploys, list) or len(deploys) > 20:
        raise ValueError("Unexpected deployment list schema.")
    for entry in deploys:
        deploy = entry.get("deploy", entry) if isinstance(entry, dict) else None
        if not isinstance(deploy, dict):
            raise ValueError("Unexpected deployment record.")
        commit = deploy.get("commit")
        if deploy.get("status") == "live":
            if not isinstance(commit, dict) or commit.get("id") != expected:
                raise ValueError("Live deployment commit differs from the reviewed source.")
            return True
        if isinstance(commit, dict) and commit.get("id") == expected and deploy.get("status") in {"build_failed", "pre_deploy_failed", "update_failed", "canceled"}:
            raise ValueError("Render deployment failed; no automatic recreation or paid upgrade.")
    return False


def browser_environment(url):
    allowed = {'PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'DISPLAY', 'XDG_RUNTIME_DIR',
               'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy',
               'NODE_EXTRA_CA_CERTS', 'PLAYWRIGHT_CHROMIUM_EXECUTABLE'}
    return {**{k: v for k, v in os.environ.items() if k in allowed}, 'BALLINA_LIVE_URL': url}


def main():
    outcome = api.main(["--create"])
    service_id, expected = outcome["serviceId"], outcome["sourceCommit"]
    if not isinstance(service_id, str) or not re.fullmatch(r"srv-[a-z0-9]+", service_id):
        raise ValueError("Created service ID requires inspection before retrying.")
    print("::notice title=Render service created::" + json.dumps(outcome), flush=True)
    key = os.environ["RENDER_API_KEY"]
    deadline = time.monotonic() + 600
    while True:
        service = api.request("/services/" + service_id, key)
        url = verified_service(service, service_id)
        deploys = api.request("/services/" + service_id + "/deploys?limit=20", key)
        if live_commit(deploys, expected):
            break
        if time.monotonic() >= deadline:
            raise ValueError("Deployment wait exceeded ten minutes; inspect the existing service, do not recreate.")
        time.sleep(10)
    print("::notice title=Render deployed source verified::" + json.dumps({"serviceId": service_id, "url": url, "sourceCommit": expected}), flush=True)
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run(["node", "web/scripts/check-live-host.cjs"], cwd=root,
                            env=browser_environment(url))
    if result.returncode:
        raise ValueError("Hosted browser verification failed; service creation is not readiness.")


if __name__ == "__main__":
    try:
        main()
    except json.JSONDecodeError:
        print("Deployment API JSON invalid; no response body logged.")
        raise SystemExit(1)
    except OSError:
        print("Deployment transport failed; inspect the existing service before retrying.")
        raise SystemExit(1)
    except ValueError as error:
        print(str(error))
        raise SystemExit(1)
