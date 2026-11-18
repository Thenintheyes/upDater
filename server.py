#!/usr/bin/env python3
import json
import re
import subprocess
import threading
import urllib.parse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "dnf-updates.json"
REPOSITORY_RE = re.compile(
    r"^\s*(?P<name>\S+)\s+(?P<arch>\S+)\s+(?P<version>\S+)\s+"
    r"(?P<repo>\S+)\s+(?P<size>[\d.]+\s+(?:B|KiB|MiB|GiB))\s*$"
)
COUNT_RE = re.compile(r"^ (Installing|Upgrading|Replacing|Removing):\s+(\d+) packages", re.MULTILINE)
TOTAL_RE = re.compile(r"^Total size of inbound packages is ([^.]+\b)", re.MULTILINE)
EXTRA_RE = re.compile(
    r"^After this operation, (.+?) extra will be used "
    r"\(install (.+?), remove (.+?)\)\.",
    re.MULTILINE,
)


def parse_dnf(output):
    upgrades = []
    current = None
    pending = None

    for line in output.splitlines():
        if line.strip() == "Upgrading:":
            current = "upgrading"
            continue
        if line.strip() in ("Installing:", "Replacing:", "Removing:"):
            current = None
            continue
        if line.strip() == "Transaction Summary:":
            current = None
            continue

        replace_match = re.match(
            r"^\s+replacing\s+\S+\s+(?:\S+)\s+(?P<version>\S+)",
            line,
        )
        if replace_match and current == "upgrading" and pending:
            pending["old_version"] = replace_match.group("version").lstrip("0:")
            continue

        match = REPOSITORY_RE.match(line)
        if not match or current != "upgrading":
            continue

        data = match.groupdict()
        if "replacing" in line.lower():
            if pending:
                pending["old_version"] = data["version"].lstrip("0:")
            continue

        pending = {
            "name": data["name"],
            "arch": data["arch"],
            "version": data["version"].lstrip("0:"),
            "repository": data["repo"],
            "size": data["size"].strip(),
            "old_version": "",
        }
        upgrades.append(pending)

    counts = {name: int(count) for name, count in COUNT_RE.findall(output)}
    total_match = TOTAL_RE.search(output)
    extra_match = EXTRA_RE.search(output)

    return {
        "packages": upgrades,
        "count": counts.get("Upgrading", len(upgrades)),
        "installing": counts.get("Installing", 0),
        "replacing": counts.get("Replacing", 0),
        "removing": counts.get("Removing", 0),
        "download_size": total_match.group(1).strip() if total_match else "0 MiB",
        "extra_size": extra_match.group(1).strip() if extra_match else "0 MiB",
        "install_size": extra_match.group(2).strip() if extra_match else "0 MiB",
        "remove_size": extra_match.group(3).strip() if extra_match else "0 MiB",
    }


def refresh_updates():
    command = [
        "dnf", "upgrade", "--assumeno", "--skip-file-locks",
        "--setopt=keepcache=true",
    ]
    result = subprocess.run(command, capture_output=True, text=True, timeout=240)
    output = result.stdout + "\n" + result.stderr
    data = parse_dnf(output)
    data["error"] = None if data["count"] else (
        "No upgrades found" if result.returncode in (0, 1) else output[-4000:]
    )
    CACHE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return data


def get_updates(refresh=False):
    if refresh or not CACHE.exists():
        return refresh_updates()
    try:
        return json.loads(CACHE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return refresh_updates()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def json_response(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/updates":
            refresh = urllib.parse.parse_qs(parsed.query).get("refresh") == ["1"]
            try:
                self.json_response(get_updates(refresh))
            except Exception as exc:
                self.json_response({"error": str(exc), "packages": [], "count": 0}, 500)
            return
        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path not in ("/api/refresh", "/api/upgrade"):
            self.json_response({"error": "Not found"}, 404)
            return

        try:
            if parsed.path == "/api/refresh":
                data = refresh_updates()
                self.json_response(data)
                return

            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            package = payload.get("package")
            command = ["pkexec", "dnf", "-y", "upgrade"]
            if package:
                if not re.fullmatch(r"[A-Za-z0-9_.+@:-]+", package):
                    self.json_response({"error": "Invalid package name"}, 400)
                    return
                command.append(package)
            process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            def refresh_after_upgrade():
                process.wait()
                refresh_updates()

            threading.Thread(target=refresh_after_upgrade, daemon=True).start()
            self.json_response({"started": True, "package": package})
        except Exception as exc:
            self.json_response({"error": str(exc)}, 500)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 4173), Handler)
    print("Fedora Software running at http://127.0.0.1:4173")
    server.serve_forever()
