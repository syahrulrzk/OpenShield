#!/usr/bin/env python3
"""
OpenShield Python Agent (Admin-Token Auth)
──────────────────────────────────────────────────────────────
Full-featured monitoring agent for hosts where richer data is
needed (file integrity, process anomalies, system metrics) or
where Python is preferred for easier customisation.

Auth model (admin-token):
   1. Admin creates agent via OpenShield UI → gets agentId + secretToken
   2. Copy credentials into /etc/openshield/agent.yaml
   3. Agent starts → first heartbeat authenticates → status ONLINE
   4. No separate /register call needed (admin already pre-registered)

Features beyond the Bash agent:
   - File Integrity Monitoring (FIM): SHA-256 hash on critical
     paths (sshd_config, passwd, sudoers, /etc/shadow, etc.)
   - Process anomaly detection: new processes matching watchlist
     (bash shells spawned by web server, rootkits, cryptominers)
   - System metrics: CPU%, RAM%, disk%, load avg, network IO
   - Pluggable parsers via entry_points

Requirements:
   - Python 3.8+
   - requests (HTTP client)
   - PyYAML (config file)
   - Standard library modules: hashlib, json, psutil (optional)

Installation:
   pip install -r requirements.txt
   sudo python3 install.py
   systemctl status openshield-agent

Config file: /etc/openshield/agent.yaml (see config.example.yaml)
State file:  /var/lib/openshield/agent.state
Log file:    /var/log/openshield/agent.log
"""

import argparse
import hashlib
import hmac
import json
import logging
import os
import signal
import socket
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import requests
except ImportError:
    print("FATAL: 'requests' not installed. pip install requests", file=sys.stderr)
    sys.exit(1)

try:
    import yaml
except ImportError:
    print("WARN: 'PyYAML' not installed — falling back to JSON config", file=sys.stderr)
    yaml = None

try:
    import psutil  # type: ignore
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False
    psutil = None  # type: ignore[assignment]  # noqa: F821

VERSION = "1.0.0"
USER_AGENT = f"OpenShield-Python-Agent/{VERSION}"

# ─── Logger ─────────────────────────────────────────────────
def setup_logger(log_file: str, debug: bool = False) -> logging.Logger:
    log = logging.getLogger("openshield-agent")
    log.setLevel(logging.DEBUG if debug else logging.INFO)
    log.handlers.clear()

    fmt = logging.Formatter(
        "[%(asctime)s] [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%SZ",
    )
    fmt.converter = time.gmtime

    # File
    try:
        fh = logging.FileHandler(log_file)
        fh.setFormatter(fmt)
        log.addHandler(fh)
    except OSError as e:
        print(f"WARN: cannot write to {log_file}: {e}", file=sys.stderr)

    # Console (stderr → captured by systemd journal)
    sh = logging.StreamHandler(sys.stderr)
    sh.setFormatter(fmt)
    log.addHandler(sh)

    return log


# ─── State ──────────────────────────────────────────────────
class AgentState:
    """Persists agent_id between runs (for sanity checks)."""

    def __init__(self, path: str, log: logging.Logger):
        self.path = path
        self.log = log
        self.agent_id: Optional[str] = None
        self.last_seen: Optional[str] = None

    def load(self) -> bool:
        try:
            with open(self.path) as f:
                for line in f:
                    line = line.strip()
                    if "=" in line:
                        k, v = line.split("=", 1)
                        if k == "agent_id":
                            self.agent_id = v
                        elif k == "last_seen":
                            self.last_seen = v
            return bool(self.agent_id)
        except FileNotFoundError:
            return False

    def save(self) -> None:
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.path, "w") as f:
            f.write(f"agent_id={self.agent_id}\n")
            f.write(f"last_seen={self.last_seen}\n")
        os.chmod(self.path, 0o600)


# ─── HMAC signing ───────────────────────────────────────────
def sign_body(secret: str, body: str) -> str:
    return "sha256=" + hmac.new(
        secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha256
    ).hexdigest()


# ─── Detection helpers ─────────────────────────────────────
def detect_host_info(log: logging.Logger) -> Dict[str, str]:
    hostname = socket.gethostname()
    try:
        ip = (
            subprocess.check_output(
                ["curl", "-s", "-4", "--max-time", "3", "https://api.ipify.org"],
                stderr=subprocess.DEVNULL,
            )
            .decode()
            .strip()
        )
        if not ip:
            raise RuntimeError("no public IP")
    except Exception:
        # Fallback to local interface
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.settimeout(2)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
        except Exception:
            ip = "0.0.0.0"

    os_desc = " ".join(
        x for x in (
            subprocess.getoutput("uname -s").strip(),
            subprocess.getoutput("uname -r").strip(),
            subprocess.getoutput("uname -m").strip(),
        ) if x
    )
    kernel = subprocess.getoutput("uname -r").strip()

    return {
        "hostname": hostname,
        "ip": ip,
        "os": os_desc,
        "kernel": kernel,
    }


def get_system_stats() -> Dict[str, Any]:
    """Returns CPU%, RAM%, disk%, load avg if psutil available, else zeros."""
    if not HAS_PSUTIL:
        return {}
    try:
        cpu = psutil.cpu_percent(interval=1)
        mem = psutil.virtual_memory()
        disk = psutil.disk_usage("/")
        load1, load5, load15 = (os.getloadavg() if hasattr(os, "getloadavg") else (0, 0, 0))
        return {
            "cpuPct": round(cpu, 1),
            "memPct": round(mem.percent, 1),
            "diskPct": round(disk.percent, 1),
            "loadAvg": round(load1, 2),
        }
    except Exception:
        return {}


def hash_file(path: str) -> Optional[str]:
    """SHA-256 of file contents. Returns None on missing/unreadable."""
    try:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()
    except (OSError, PermissionError):
        return None


# ─── File Integrity Monitor ────────────────────────────────
class FileIntegrityMonitor:
    """
    Watches critical system files for changes (hash mismatch).
    Emits 'file.change' events with old/new hash.

    Default watchlist covers common attack surfaces:
      - SSH config + keys
      - /etc/passwd, /etc/shadow, /etc/group
      - /etc/sudoers
      - cron / systemd timers
      - web server configs
    """

    DEFAULT_PATHS = [
        "/etc/passwd",
        "/etc/shadow",
        "/etc/group",
        "/etc/sudoers",
        "/etc/ssh/sshd_config",
        "/etc/crontab",
        "/etc/sudoers.d",
    ]

    def __init__(self, paths: List[str], log: logging.Logger):
        self.paths = paths or self.DEFAULT_PATHS
        self.log = log
        self.baselines: Dict[str, str] = {}

    def compute_baseline(self) -> None:
        for p in self.paths:
            h = hash_file(p)
            if h:
                self.baselines[p] = h
        self.log.info(f"FIM baseline computed for {len(self.baselines)} paths")

    def check(self) -> List[Dict[str, Any]]:
        """Returns list of file.change events since last baseline."""
        events = []
        for p in self.paths:
            current = hash_file(p)
            baseline = self.baselines.get(p)
            if current is None:
                # File became unreadable (permission revoked, removed)
                if baseline is not None:
                    events.append({
                        "eventType": "file.change",
                        "severity": "WARN",
                        "source": p,
                        "message": f"File no longer accessible: {p}",
                        "rawData": {"previousHash": baseline, "currentHash": None},
                    })
            elif baseline is None:
                # New file discovered
                self.baselines[p] = current
            elif current != baseline:
                events.append({
                    "eventType": "file.change",
                    "severity": "CRITICAL",
                    "source": p,
                    "message": f"File integrity violation: {p}",
                    "rawData": {
                        "previousHash": baseline,
                        "currentHash": current,
                    },
                })
                self.baselines[p] = current  # update baseline
        return events


# ─── Process Monitor ───────────────────────────────────────
class ProcessMonitor:
    """
    Watches for processes matching a watchlist of suspicious patterns
    (e.g., shells spawned by web servers, known malware filenames).

    Emits 'process.new' events when a watchlisted process is detected.
    """

    DEFAULT_WATCHLIST = [
        # Web server → shell
        r"^(www-data|nginx|apache|httpd|www) .* (/bin/(ba)?sh|/bin/dash)$",
        # Crypto miners (common patterns)
        r"(xmrig|cryptonight|minerd|stratum\+tcp)",
        # Reverse shells
        r"(nc|ncat|netcat)\s.*(-e\s|/bin/(ba)?sh)",
    ]

    def __init__(self, watchlist: List[str], log: logging.Logger):
        self.watchlist = watchlist or self.DEFAULT_WATCHLIST
        self.log = log
        import re
        self.patterns = [re.compile(p) for p in self.watchlist]

    def check(self) -> List[Dict[str, Any]]:
        """Returns list of process.new events for watchlisted processes."""
        if not HAS_PSUTIL:
            return []
        events = []
        try:
            for proc in psutil.process_iter(["pid", "name", "username", "cmdline"]):
                try:
                    info = proc.info
                    cmdline = " ".join(info.get("cmdline") or [])
                    user = info.get("username") or "?"
                    name = info.get("name") or ""
                    full = f"{user} {cmdline}".strip()
                    for pat in self.patterns:
                        if pat.search(full):
                            events.append({
                                "eventType": "process.new",
                                "severity": "CRITICAL",
                                "source": f"pid:{info.get('pid')}",
                                "message": f"Suspicious process matched: {name}",
                                "rawData": {
                                    "pid": info.get("pid"),
                                    "name": name,
                                    "user": user,
                                    "cmdline": cmdline[:512],
                                    "matchedPattern": pat.pattern,
                                },
                            })
                            break
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
        except Exception as e:
            self.log.warning(f"Process scan failed: {e}")
        return events


# ─── Agent ─────────────────────────────────────────────────
class OpenShieldAgent:
    def __init__(self, config_path: str, debug: bool = False):
        self.debug = debug
        self.config = self._load_config(config_path)
        self.log = setup_logger(self.config["log_file"], debug)

        self.server_url = self.config["server_url"].rstrip("/")
        self.agent_id = self.config["agent_id"]  # from admin UI
        self.secret_token = self.config["secret_token"]  # from admin UI (shown ONCE)
        self.agent_name = self.config.get("agent_name") or socket.gethostname()
        self.heartbeat_interval = int(self.config.get("heartbeat_interval", 30))
        self.event_batch_size = int(self.config.get("event_batch_size", 100))

        state_dir = self.config.get("state_dir", "/var/lib/openshield")
        log_dir = self.config.get("log_dir", "/var/log/openshield")
        os.makedirs(state_dir, exist_ok=True)
        os.makedirs(log_dir, exist_ok=True)
        self.state = AgentState(os.path.join(state_dir, "agent.state"), self.log)

        self.fim = FileIntegrityMonitor(
            self.config.get("fim_paths") or [], self.log
        )
        self.procmon = ProcessMonitor(
            self.config.get("process_watchlist") or [], self.log
        )

        self.event_buffer: List[Dict[str, Any]] = []
        self.running = True
        signal.signal(signal.SIGTERM, self._handle_signal)
        signal.signal(signal.SIGINT, self._handle_signal)

    def _load_config(self, path: str) -> Dict[str, Any]:
        defaults = {
            "server_url": "http://127.0.0.1:3001",
            "agent_id": "",
            "secret_token": "",
            "agent_name": None,
            "heartbeat_interval": 30,
            "event_batch_size": 100,
            "log_file": "/var/log/openshield/agent.log",
            "state_dir": "/var/lib/openshield",
            "log_dir": "/var/log/openshield",
            "fim_paths": None,
            "process_watchlist": None,
        }
        if not os.path.exists(path):
            return defaults
        try:
            with open(path) as f:
                text = f.read()
            data = (
                yaml.safe_load(text)
                if yaml and not path.endswith(".json")
                else json.loads(text)
            )
            if isinstance(data, dict):
                defaults.update(data)
        except Exception as e:
            print(f"WARN: config parse failed: {e}, using defaults", file=sys.stderr)
        # Env var overrides (also support legacy names from bootstrap flow)
        for key, env_name in (
            ("server_url", "OPENSHIELD_SERVER_URL"),
            ("agent_id", "OPENSHIELD_AGENT_ID"),
            ("secret_token", "OPENSHIELD_SECRET_TOKEN"),
            ("agent_name", "OPENSHIELD_AGENT_NAME"),
            ("heartbeat_interval", "OPENSHIELD_HEARTBEAT_INTERVAL"),
            ("event_batch_size", "OPENSHIELD_EVENT_BATCH_SIZE"),
            ("state_dir", "OPENSHIELD_STATE_DIR"),
            ("log_dir", "OPENSHIELD_LOG_DIR"),
            ("log_file", "OPENSHIELD_LOG_FILE"),
        ):
            env_val = os.environ.get(env_name)
            if env_val:
                defaults[key] = env_val
        return defaults

    def _handle_signal(self, signum: int, _frame) -> None:
        self.log.info(f"Received signal {signum}, shutting down…")
        self.running = False

    def _request(
        self,
        method: str,
        path: str,
        body: Optional[str] = None,
        extra_headers: Optional[Dict[str, str]] = None,
        timeout: int = 10,
    ) -> Tuple[bool, Any]:
        url = self.server_url + path
        headers = {"User-Agent": USER_AGENT, "Content-Type": "application/json"}
        if extra_headers:
            headers.update(extra_headers)
        try:
            r = requests.request(method, url, data=body, headers=headers, timeout=timeout)
            if r.status_code >= 400:
                self.log.warning(f"{method} {path} → {r.status_code}: {r.text[:200]}")
                return False, r.text
            return True, r.json() if r.text else {}
        except requests.RequestException as e:
            self.log.warning(f"{method} {path} → network error: {e}")
            return False, str(e)

    def register(self) -> bool:
        # New flow: agent is pre-registered by admin. Just verify creds by
        # sending a "warmup" heartbeat to check the server accepts us.
        if not self.agent_id:
            self.log.error("agent_id not set. Get it from OpenShield UI (Add Agent).")
            return False
        if not self.secret_token:
            self.log.error("secret_token not set. Get it from OpenShield UI (Add Agent).")
            return False
        # Send identity-update heartbeat (no events)
        body_obj = {
            "version": VERSION,
            "events": [],
            "stats": get_system_stats(),
        }
        info = detect_host_info(self.log)
        body_obj["identity"] = {
            "hostname": info["hostname"],
            "ip": info["ip"],
            "os": info["os"],
            "kernel": info["kernel"],
        }
        body = json.dumps(body_obj)
        sig = sign_body(self.secret_token, body)
        headers = {
            "X-Openshield-Agent-Id": self.agent_id,
            "X-Openshield-Agent-Signature": sig,
        }
        ok, data = self._request("POST", "/api/agents/heartbeat", body, headers)
        if not ok:
            self.log.error(f"Initial heartbeat failed: {data}")
            return False
        self.state.agent_id = self.agent_id
        self.state.last_seen = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        self.state.save()
        self.log.info(
            f"Authenticated as {self.agent_name} (id: {self.agent_id[:12]}…) — status: {data.get('status', '?')}"
        )
        return True

    def buffer_event(
        self,
        event_type: str,
        severity: str,
        source: str,
        message: str,
        raw_data: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.event_buffer.append({
            "eventType": event_type,
            "severity": severity,
            "source": source[:512],
            "message": message[:2048],
            "rawData": raw_data,
            "eventTime": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        })
        if len(self.event_buffer) >= self.event_batch_size:
            self.flush()

    def flush(self) -> bool:
        body_obj = {
            "version": VERSION,
            "events": self.event_buffer,
            "stats": get_system_stats(),
        }
        body = json.dumps(body_obj)
        sig = sign_body(self.secret_token, body)
        headers = {
            "X-Openshield-Agent-Id": self.agent_id,
            "X-Openshield-Agent-Signature": sig,
        }
        ok, data = self._request("POST", "/api/agents/heartbeat", body, headers)
        if ok:
            stats = data.get("stats", {})
            self.log.debug(
                f"Heartbeat OK (events={len(self.event_buffer)} "
                f"inserted={stats.get('eventsInserted', 0)} "
                f"deduped={stats.get('eventsDeduped', 0)})"
            )
            self.event_buffer = []
            return True
        return False

    def run(self) -> None:
        if not self.agent_id:
            self.log.error(
                "agent_id not set. Run 'Add Agent' in OpenShield UI and copy "
                "credentials to your config file."
            )
            sys.exit(2)
        if not self.secret_token:
            self.log.error(
                "secret_token not set. Run 'Add Agent' in OpenShield UI and copy "
                "credentials to your config file."
            )
            sys.exit(2)
        # Sanity check: state file agent_id should match config
        if self.state.load() and self.state.agent_id and self.state.agent_id != self.agent_id:
            self.log.warning(
                f"Agent ID in state file ({self.state.agent_id[:12]}…) differs from "
                f"config ({self.agent_id[:12]}…). Using config value."
            )
        self.log.info(f"Agent authenticated as: {self.agent_name} ({self.agent_id[:12]}…)")

        # Initial FIM baseline
        try:
            self.fim.compute_baseline()
        except Exception as e:
            self.log.warning(f"FIM baseline failed: {e}")

        self.log.info(
            f"Starting main loop (heartbeat={self.heartbeat_interval}s, "
            f"batch={self.event_batch_size})"
        )
        try:
            while self.running:
                # 1. FIM check
                for ev in self.fim.check():
                    self.buffer_event(**ev)
                # 2. Process monitor
                for ev in self.procmon.check():
                    self.buffer_event(**ev)
                # 3. Heartbeat (with or without events)
                self.flush()
                # 4. Sleep
                for _ in range(self.heartbeat_interval):
                    if not self.running:
                        break
                    time.sleep(1)
        except KeyboardInterrupt:
            self.log.info("Interrupted")
        finally:
            self.log.info("Final flush before exit")
            self.flush()


# ─── CLI ───────────────────────────────────────────────────
def main():
    p = argparse.ArgumentParser(description="OpenShield Python Agent")
    p.add_argument("-c", "--config", default="/etc/openshield/agent.yaml",
                   help="Config file path (YAML or JSON)")
    p.add_argument("-d", "--debug", action="store_true",
                   help="Enable debug logging")
    p.add_argument("--register-only", action="store_true",
                   help="Register and exit (for testing)")
    args = p.parse_args()

    agent = OpenShieldAgent(args.config, debug=args.debug)
    if args.register_only:
        sys.exit(0 if agent.register() else 1)
    agent.run()


if __name__ == "__main__":
    main()
