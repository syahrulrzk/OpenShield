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
import re
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

VERSION = "1.2.1"
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
# Prefixes we should *never* report as the agent IP. These are virtual
# interfaces, tunnels, or special-purpose addresses that misrepresent
# the host when listed on a monitoring dashboard.
_BAD_IFACE_PREFIXES = (
    "docker",    # docker bridge (172.17.0.1, 172.18.0.1, …)
    "br-",       # docker custom bridges (br-cc87cce1d5cd, …)
    "veth",      # virtual ethernet pair (one per container)
    "virbr",     # libvirt default bridge (192.168.122.1)
    "tun",       # generic L3 tunnel
    "tap",       # generic L2 tunnel
    "tailscale", # userspace WireGuard — not the host's primary IP
    "wg",        # WireGuard interface
    "zt",        # ZeroTier
    "lo",        # loopback
)
_BAD_IP_PREFIXES = (
    "127.",          # loopback
    "169.254.",      # link-local (APIPA)
    "0.0.0.0",       # invalid
    "192.168.122.",  # libvirt default bridge (virbr0)
)


def _pick_linux_default_ip() -> str | None:
    """
    Best-effort detection of the host's *internal* IPv4 address.

    Strategy:
      1. `ip route get 1.1.1.1` — Linux route table knows which source
         IP the kernel would use to reach the internet. This is the
         most accurate answer on a multi-homed host (Tailscale +
         Docker + LAN at the same time), because it is the same
         decision the kernel makes for outbound traffic.
      2. Pick the first non-virtual, non-loopback, non-link-local
         address from `hostname -I`.
      3. Last-resort UDP "connect" trick — opens a socket to 8.8.8.8
         without sending any packets, then reads the source IP from
         getsockname(). This used to be the fallback before; we keep
         it as a final safety net.

    Returns None if nothing usable was found.
    """
    # ── 1. ip route get 1.1.1.1 ──────────────────────────────────
    try:
        out = subprocess.check_output(
            ["ip", "-4", "route", "get", "1.1.1.1"],
            stderr=subprocess.DEVNULL,
            timeout=2,
        ).decode().strip()
        # Line looks like:  "1.1.1.1 via 10.0.0.1 dev ens160 src 172.16.19.235 uid 0"
        # Find the literal "src" token, then take the *next* token as the IP.
        # (Earlier we tried `token.startswith("src")` which also matched the
        # bare "src" word itself and returned an empty string.)
        tokens = out.split()
        for i, token in enumerate(tokens):
            if token == "src" and i + 1 < len(tokens):
                candidate = tokens[i + 1].strip()
                if candidate and not candidate.startswith(_BAD_IP_PREFIXES):
                    return candidate
    except Exception:
        pass

    # ── 2. hostname -I, filtering virtual interfaces ─────────────
    try:
        out = subprocess.check_output(
            ["hostname", "-I"], stderr=subprocess.DEVNULL, timeout=2
        ).decode().strip()
        for candidate in out.split():
            if candidate and not candidate.startswith(_BAD_IP_PREFIXES):
                # `hostname -I` includes *all* addresses, including
                # docker/tailscale. Cross-check against the interface
                # list to drop virtual ones.
                try:
                    link_out = subprocess.check_output(
                        ["ip", "-4", "-o", "addr", "show"], stderr=subprocess.DEVNULL, timeout=2
                    ).decode()
                    for line in link_out.splitlines():
                        # "ens160    inet 172.16.19.235/16 brd …"
                        parts = line.split()
                        if len(parts) >= 4 and parts[2] == "inet":
                            ifname = parts[1]
                            addr_with_mask = parts[3]
                            addr = addr_with_mask.split("/")[0]
                            if addr == candidate and not ifname.startswith(_BAD_IFACE_PREFIXES):
                                return candidate
                except Exception:
                    return candidate  # best guess if we can't read the interface table
    except Exception:
        pass

    # ── 3. UDP socket trick (legacy fallback) ─────────────────────
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(2)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith(_BAD_IP_PREFIXES):
            return ip
    except Exception:
        pass

    return None


def detect_host_info(log: logging.Logger) -> Dict[str, str]:
    """
    Detect basic host metadata for the agent registration payload.

    IMPORTANT: `ip` is the *internal* IPv4 address of the host, NOT the
    public IP. We previously fetched this from api.ipify.org which
    returned the NAT egress IP — useless for a monitoring dashboard
    that wants to know "where do I find this host on my network".
    See _pick_linux_default_ip() for the full selection strategy.
    """
    hostname = socket.gethostname()
    ip = _pick_linux_default_ip() or "0.0.0.0"
    if ip == "0.0.0.0":
        log.warning("could not detect a usable internal IPv4 address; reporting 0.0.0.0")

    # Prefer distro name from /etc/os-release (e.g. "Ubuntu 24.04 LTS",
    # "Debian GNU/Linux 12"). Fall back to uname if not present.
    os_desc = ""
    try:
        with open("/etc/os-release") as f:
            data = dict(
                line.strip().split("=", 1)
                for line in f
                if "=" in line and not line.strip().startswith("#")
            )
        pretty = data.get("PRETTY_NAME", "").strip().strip('"')
        version = data.get("VERSION_ID", "").strip().strip('"')
        if pretty:
            os_desc = pretty
        elif data.get("NAME"):
            os_desc = data["NAME"].strip().strip('"')
            if version:
                os_desc += " " + version
    except FileNotFoundError:
        pass
    except Exception:
        pass

    if not os_desc:
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


# ─── Log Tailer ──────────────────────────────────────
class SshdParser:
    """
    Parse sshd log lines (auth.log on Ubuntu/Debian, /var/log/secure on RHEL).

    Emits 'log.line' events with severity:
      - ERROR:   failed authentications, invalid users, disconnects
      - INFO:    successful sessions, session opens/closes
      - WARN:    protocol errors, malformed input
    """

    # "Failed password for invalid user testuser from 10.0.0.5 port 51234 ssh2"
    # "Failed password for gm from 10.0.0.5 port 51234 ssh2"
    RE_FAILED_PASSWORD = re.compile(
        r"Failed password for (?:invalid user )?(\S+) from ([\d.]+) port (\d+) ssh2"
    )
    # "Invalid user testuser from 10.0.0.5"
    RE_INVALID_USER = re.compile(
        r"Invalid user (\S+) from ([\d.]+)"
    )
    # "Accepted password for gm from 10.0.0.5 port 51234 ssh2"
    RE_ACCEPTED_PASSWORD = re.compile(
        r"Accepted (?:password|publickey) for (\S+) from ([\d.]+) port (\d+) ssh2"
    )
    # "Did not receive identification string from 10.0.0.5"
    RE_NO_IDENT = re.compile(
        r"Did not receive identification string from ([\d.]+)"
    )
    # "Connection closed by authenticating user testuser 10.0.0.5 port 51234 [preauth]"
    RE_CONN_CLOSED = re.compile(
        r"Connection closed by (?:authenticating user )?(\S+)?\s*([\d.]+)?\s*port (\d+)"
    )
    # "error: maximum authentication attempts exceeded for gm from 10.0.0.5 port 51234 ssh2"
    RE_MAX_AUTH = re.compile(
        r"maximum authentication attempts exceeded for (\S+) from ([\d.]+) port (\d+)"
    )
    # "Starting session: subsystem 'sftp' for linux from 10.1.1.100 port 52657 id 0"
    RE_SFTP_SESSION = re.compile(
        r"Starting session: subsystem 'sftp' for (\S+) from ([\d.]+) port (\d+)"
    )
    # "Starting session: subsystem 'internal-sftp' for rizki from 1.2.3.4 port 22 id 0"
    RE_SFTP_SUBSYS = re.compile(
        r"Starting session: subsystem 'internal-sftp' for (\S+) from ([\d.]+) port (\d+)"
    )
    # "Starting session: subsystem 'scp' for rizki from 1.2.3.4 port 22 id 0"
    RE_SCP_SESSION = re.compile(
        r"Starting session: subsystem 'scp' for (\S+) from ([\d.]+) port (\d+)"
    )
    # "Starting session: shell on pts/1 for linux from 10.1.1.100 port 49942 id 0"
    # Generic shell session — PuTTY/terminal/macOS Terminal/iTerm login.
    # tty is like "pts/1", "tty/1", or "0" for console.
    RE_SHELL_SESSION = re.compile(
        r"Starting session: shell (?:on (\S+) )?for (\S+) from ([\d.]+) port (\d+)"
    )
    # "Starting session: command sh -c 'uname -a' for linux from 10.1.1.100 port 22 id 1"
    # Also matches the bare form `Starting session: command for user from ... id N`
    # (sshd emits this when the session is a child fork without an exec payload,
    # e.g. WinSCP's `scp -t /path` wrapper logs as `command scp -t /path` but
    # some Linux distros truncate to just `command` if the command is empty).
    # Group 1 is optional; Group 2 is user.
    RE_COMMAND_SESSION = re.compile(
        r"Starting session: command(?: (.+?))? for (\S+) from ([\d.]+) port (\d+)"
    )
    # "Connection from 10.1.1.100 port 50322 on 172.16.19.235 port 22 rdomain \"\""
    # sshd logs this on the FIRST line of every incoming connection — captures
    # both the client source port (ephemeral, random per connection) and the
    # server destination port (typically 22 for SSH, or 2222 / 5322 / etc if
    # the daemon listens on a non-standard port). Useful for:
    #   - distinguishing real SSH connections from honeypots / port scans
    #   - detecting SSH on non-standard ports (security audit)
    # rdomain may be empty (\"\") or a SELinux context (\"system_u:...\").
    # The rdomain group is non-capturing because we don't need the SELinux label.
    RE_CONN_FROM = re.compile(
        r"Connection from ([\d.]+) port (\d+) on ([\d.]+) port (\d+)"
    )

    def parse(self, line: str) -> Optional[Dict[str, Any]]:
        """Return event dict or None if line doesn't match sshd patterns."""
        # Strip timestamp + hostname prefix (everything up to first ': ' AFTER hostname)
        # auth.log format: "2026-06-20T18:00:00.000Z hostname sshd[pid]: ..."
        m = self.RE_FAILED_PASSWORD.search(line)
        if m:
            user, ip, port = m.groups()
            return {
                "event_type": "log.line",
                "severity": "ERROR",
                "source": "/var/log/auth.log",
                "message": f"SSH login failed: user={user}, ip={ip}",
                "raw_data": {
                    "event": "sshd.failed_password",
                    "user": user,
                    "ip": ip,
                    "port": int(port),       # client source port (ephemeral, random per conn)
                    "serverPort": 22,        # SSH server port (implicit in auth.log)
                    "parser": "sshd",
                },
            }
        m = self.RE_INVALID_USER.search(line)
        if m:
            user, ip = m.groups()
            return {
                "event_type": "log.line",
                "severity": "WARN",
                "source": "/var/log/auth.log",
                "message": f"SSH invalid user: {user} from {ip}",
                "raw_data": {
                    "event": "sshd.invalid_user",
                    "user": user,
                    "ip": ip,
                    "parser": "sshd",
                },
            }
        m = self.RE_ACCEPTED_PASSWORD.search(line)
        if m:
            user, ip, port = m.groups()
            return {
                "event_type": "log.line",
                "severity": "INFO",
                "source": "/var/log/auth.log",
                "message": f"SSH login success: user={user}, ip={ip}",
                "raw_data": {
                    "event": "sshd.accepted",
                    "user": user,
                    "ip": ip,
                    "port": int(port),
                    "parser": "sshd",
                },
            }
        m = self.RE_MAX_AUTH.search(line)
        if m:
            user, ip, port = m.groups()
            return {
                "event_type": "log.line",
                "severity": "ERROR",
                "source": "/var/log/auth.log",
                "message": f"SSH max auth attempts exceeded: user={user}, ip={ip}",
                "raw_data": {
                    "event": "sshd.max_auth",
                    "user": user,
                    "ip": ip,
                    "port": int(port),
                    "parser": "sshd",
                },
            }
        m = self.RE_NO_IDENT.search(line)
        if m:
            ip = m.group(1)
            return {
                "event_type": "log.line",
                "severity": "WARN",
                "source": "/var/log/auth.log",
                "message": f"SSH no identification string from {ip}",
                "raw_data": {
                    "event": "sshd.no_ident",
                    "ip": ip,
                    "parser": "sshd",
                },
            }
        m = self.RE_CONN_CLOSED.search(line)
        if m:
            user, ip, port = m.groups()
            return {
                "event_type": "log.line",
                "severity": "INFO",
                "source": "/var/log/auth.log",
                "message": f"SSH connection closed: user={user or '?'}, ip={ip or '?'}",
                "raw_data": {
                    "event": "sshd.conn_closed",
                    "user": user,
                    "ip": ip,
                    "port": int(port) if port else None,
                    "serverPort": 22,       # SSH server port (implicit in auth.log)
                    "parser": "sshd",
                },
            }
        m = self.RE_SFTP_SESSION.search(line)
        if m:
            user, ip, port = m.groups()
            return {
                "event_type": "log.line",
                "severity": "INFO",
                "source": "/var/log/auth.log",
                "message": f"SFTP session opened: user={user}, ip={ip}",
                "raw_data": {
                    "event": "sshd.sftp_session",
                    "user": user,
                    "ip": ip,
                    "port": int(port),       # client source port (ephemeral, random per conn)
                    "serverPort": 22,        # SSH server port (implicit in auth.log)
                    "service": "SFTP",
                    "parser": "sshd",
                },
            }
        m = self.RE_SFTP_SUBSYS.search(line)
        if m:
            user, ip, port = m.groups()
            return {
                "event_type": "log.line",
                "severity": "INFO",
                "source": "/var/log/auth.log",
                "message": f"SFTP session opened (internal-sftp): user={user}, ip={ip}",
                "raw_data": {
                    "event": "sshd.sftp_session",
                    "user": user,
                    "ip": ip,
                    "port": int(port),       # client source port (ephemeral, random per conn)
                    "serverPort": 22,        # SSH server port (implicit in auth.log)
                    "service": "SFTP",
                    "parser": "sshd",
                },
            }
        m = self.RE_SCP_SESSION.search(line)
        if m:
            user, ip, port = m.groups()
            return {
                "event_type": "log.line",
                "severity": "INFO",
                "source": "/var/log/auth.log",
                "message": f"SCP session opened: user={user}, ip={ip}",
                "raw_data": {
                    "event": "sshd.scp_session",
                    "user": user,
                    "ip": ip,
                    "port": int(port),       # client source port (ephemeral, random per conn)
                    "serverPort": 22,        # SSH server port (implicit in auth.log)
                    "service": "SCP",
                    "parser": "sshd",
                },
            }
        m = self.RE_SHELL_SESSION.search(line)
        if m:
            tty, user, ip, port = m.groups()
            return {
                "event_type": "log.line",
                "severity": "INFO",
                "source": "/var/log/auth.log",
                "message": f"SSH shell session opened: user={user}, ip={ip}, tty={tty or 'console'}",
                "raw_data": {
                    "event": "sshd.shell_session",
                    "user": user,
                    "ip": ip,
                    "port": int(port),       # client source port (ephemeral, random per conn)
                    "serverPort": 22,        # SSH server port (implicit in auth.log)
                    "tty": tty,
                    "service": "SSH",
                    "parser": "sshd",
                },
            }
        m = self.RE_COMMAND_SESSION.search(line)
        if m:
            cmd, user, ip, port = m.groups()
            # cmd can be None (bare `Starting session: command for user from ...`)
            cmd_str = cmd or "(no command)"
            # Truncate command to keep events compact. WinSCP wraps SCP
            # as a `command` session — still useful to log.
            cmd_short = cmd_str[:80] + ("…" if len(cmd_str) > 80 else "")
            return {
                "event_type": "log.line",
                "severity": "INFO",
                "source": "/var/log/auth.log",
                "message": f"SSH command exec: user={user}, ip={ip}, cmd={cmd_short}",
                "raw_data": {
                    "event": "sshd.command_session",
                    "user": user,
                    "ip": ip,
                    "port": int(port),       # client source port (ephemeral)
                    "serverPort": 22,       # SSH server port (implicit in log)
                    "command": cmd_short,
                    "service": "SSH",
                    "parser": "sshd",
                },
            }
        # First line of every incoming TCP connection. We surface this as a
        # separate event so dashboards can show "who tried to connect" before
        # any auth attempt — useful for detecting port scans and failed-handshake
        # bursts. Low severity because not every connection is malicious.
        m = self.RE_CONN_FROM.search(line)
        if m:
            client_ip, client_port, server_ip, server_port = m.groups()
            # Heuristic: if server_port != 22, flag as "non-standard SSH" so
            # security audits can quickly surface unexpected listeners.
            is_standard = (int(server_port) == 22)
            return {
                "event_type": "log.line",
                "severity": "INFO",
                "source": "/var/log/auth.log",
                "message": (
                    f"SSH connection from {client_ip}:{client_port} → "
                    f"{server_ip}:{server_port}"
                    f"{'' if is_standard else ' (non-standard SSH port)'}"
                ),
                "raw_data": {
                    "event": "sshd.connection",
                    "ip": client_ip,
                    "port": int(client_port),   # client source port (random)
                    "serverIp": server_ip,
                    "serverPort": int(server_port),
                    "isStandardPort": is_standard,
                    "service": "SSH",
                    "parser": "sshd",
                },
            }
        return None


class SyslogParser:
    """
    Stub parser for syslog — emits all lines as INFO by default.
    Syslog is too noisy (kernel/dhclient/cron), so we recommend
    keeping it disabled in agent.yaml. Add filters here if needed.
    """

    def parse(self, line: str) -> Optional[Dict[str, Any]]:
        return None  # disabled by default; see audit notes


PARSERS: Dict[str, Any] = {
    "sshd": SshdParser,
    "syslog": SyslogParser,
}


class LogTailer:
    """
    Tails log files from a watchlist, emits parsed events for new lines.

    Config format (agent.yaml):
      log_watchers:
        - path: /var/log/auth.log
          parser: sshd
        - path: /var/log/secure
          parser: sshd

    State (per-file):
      - offset: bytes already read (saved to log_offsets.json)
      - inode: file identity (so we can detect log rotation/truncation)

    Truncation handling: if file size < saved offset OR inode changes,
    we reset offset to 0 (start from beginning of new file). For
    rotation-without-rename (e.g., copytruncate), this means we may
    re-emit some lines, but the server-side dedup (5-min window)
    keeps the dashboard clean.

    Crash safety: offsets saved to log_offsets.json after each successful
    tick. Atomic write via temp file + rename.
    """

    MAX_LINE_BYTES = 8192  # skip absurdly long lines (binary garbage etc.)
    MAX_LINES_PER_TICK = 500  # cap to avoid memory blow-up

    def __init__(self, watchers: List[Dict[str, str]], state_dir: str, log: logging.Logger):
        self.log = log
        self.state_dir = state_dir
        self.offsets_path = os.path.join(state_dir, "log_offsets.json")
        self.offsets: Dict[str, int] = {}
        self.inodes: Dict[str, int] = {}
        # Build list of (path, parser_instance) — skip unknown parsers
        self.targets: List[Tuple[str, Any]] = []
        for w in watchers or []:
            path = w.get("path")
            parser_name = w.get("parser", "sshd")
            if not path:
                continue
            if parser_name not in PARSERS:
                self.log.warning(f"Unknown parser '{parser_name}' for {path}, skipping")
                continue
            self.targets.append((path, PARSERS[parser_name]()))
        self._load_state()

    def _load_state(self) -> None:
        try:
            with open(self.offsets_path) as f:
                data = json.load(f)
            if isinstance(data, dict):
                # Backwards-compat: old format was {"path": offset}
                # New format: {"offsets": {...}, "inodes": {...}}
                if "offsets" in data:
                    self.offsets = {k: int(v) for k, v in data["offsets"].items()}
                    self.inodes = {k: int(v) for k, v in data.get("inodes", {}).items()}
                else:
                    self.offsets = {k: int(v) for k, v in data.items()}
        except (FileNotFoundError, json.JSONDecodeError, ValueError) as e:
            self.log.debug(f"No prior log_offsets state ({type(e).__name__})")
        self.log.info(
            f"LogTailer: watching {len(self.targets)} file(s) "
            f"(existing offsets: {len(self.offsets)})"
        )
        for path, _ in self.targets:
            off = self.offsets.get(path, 0)
            ino = self.inodes.get(path, 0)
            parser_name = "?"
            for w in (self.targets or []):
                if w[0] == path:
                    pass
            self.log.info(f"  \u2022 {path} (offset={off}, inode={ino})")

    def _save_state(self) -> None:
        """Atomic write: temp file + rename, so a crash mid-write doesn't corrupt state."""
        try:
            os.makedirs(self.state_dir, exist_ok=True)
            tmp = self.offsets_path + ".tmp"
            payload = {"offsets": self.offsets, "inodes": self.inodes}
            with open(tmp, "w") as f:
                json.dump(payload, f, indent=2)
                f.flush()
                os.fsync(f.fileno())
            os.rename(tmp, self.offsets_path)
            os.chmod(self.offsets_path, 0o600)
        except Exception as e:
            self.log.warning(f"log_offsets save failed: {e}")

    def tick(self) -> List[Dict[str, Any]]:
        """
        Read new lines from each watched file, parse, return events.
        Should be called once per main-loop iteration (e.g., every 30s).
        """
        events: List[Dict[str, Any]] = []
        for path, parser in self.targets:
            if not os.path.exists(path):
                # File doesn't exist (e.g., /var/log/secure on Ubuntu) — silently skip
                self.log.debug(f"Skip {path} (does not exist)")
                continue
            try:
                st = os.stat(path)
            except OSError as e:
                self.log.debug(f"Skip {path} (stat failed: {e})")
                continue
            inode = st.st_ino
            size = st.st_size
            offset = self.offsets.get(path, 0)
            prev_inode = self.inodes.get(path, 0)

            # Detect truncation/rotation
            if size < offset or (prev_inode and inode != prev_inode):
                self.log.info(
                    f"{path}: rotation/truncation detected "
                    f"(size={size} < offset={offset} or inode changed). Resetting to 0."
                )
                offset = 0

            if size == offset:
                # Nothing new
                self.inodes[path] = inode
                continue

            # Read new content
            try:
                with open(path, "r", errors="replace") as f:
                    f.seek(offset)
                    raw = f.read(size - offset)
            except OSError as e:
                self.log.warning(f"{path}: read failed: {e}")
                continue

            lines = raw.splitlines()
            new_offset = offset + len(raw.encode("utf-8", errors="replace"))
            parsed_count = 0
            for line in lines[: self.MAX_LINES_PER_TICK]:
                if len(line) > self.MAX_LINE_BYTES:
                    continue
                try:
                    ev = parser.parse(line)
                except Exception as e:
                    self.log.debug(f"{path}: parser exception: {e}")
                    ev = None
                if ev:
                    events.append(ev)
                    parsed_count += 1

            self.offsets[path] = new_offset
            self.inodes[path] = inode
            if parsed_count or lines:
                self.log.info(
                    f"{path}: read {len(lines)} new line(s), parsed {parsed_count}"
                )

        if events:
            self._save_state()
        return events


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
                        "event_type": "file.change",
                        "severity": "WARN",
                        "source": p,
                        "message": f"File no longer accessible: {p}",
                        "raw_data": {"previousHash": baseline, "currentHash": None},
                    })
            elif baseline is None:
                # New file discovered
                self.baselines[p] = current
            elif current != baseline:
                events.append({
                    "event_type": "file.change",
                    "severity": "CRITICAL",
                    "source": p,
                    "message": f"File integrity violation: {p}",
                    "raw_data": {
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
                                "event_type": "process.new",
                                "severity": "CRITICAL",
                                "source": f"pid:{info.get('pid')}",
                                "message": f"Suspicious process matched: {name}",
                                "raw_data": {
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
        self.logtailer = LogTailer(
            self.config.get("log_watchers") or [],
            state_dir,
            self.log,
        )
        # Identity: detected on every restart (this __init__) and refreshed
        # every hour by flush(). Bos wants identity sent on EVERY restart,
        # not just initial install — so server can track DHCP changes,
        # IP rotation, hostname changes, etc.
        self._identity_refresh_interval = 3600  # 1 hour
        self._identity_last_refresh: float = 0.0
        self._identity: Dict[str, str] = {}  # init empty dict FIRST so _refresh_identity can compare
        self._refresh_identity(force=True)

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
            "log_watchers": None,
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

    def _refresh_identity(self, force: bool = False) -> None:
        """Re-detect hostname/IP/OS/kernel and update cache.

        Called on:
          - __init__ (every agent restart → Bos's requirement)
          - flush() if > 1 hour since last refresh (catches DHCP/IP rotation)
          - force=True bypasses the timer
        """
        now = time.time()
        if not force and (now - self._identity_last_refresh) < self._identity_refresh_interval:
            return
        try:
            info = detect_host_info(self.log)
            new_identity = {
                "hostname": info.get("hostname"),
                "ip": info.get("ip"),
                "os": info.get("os"),
                "kernel": info.get("kernel"),
            }
            # Compare against cache and log only if changed
            if new_identity != self._identity:
                self.log.info(
                    f"Identity refresh: hostname={new_identity.get('hostname')}, "
                    f"ip={new_identity.get('ip')}, os={new_identity.get('os')}"
                )
            self._identity = new_identity
            self._identity_last_refresh = now
        except Exception as e:
            self.log.warning(f"detect_host_info failed during refresh: {e}")

    def flush(self) -> bool:
        # Refresh identity if > 1 hour since last detect (handles DHCP lease
        # renewal, IP rotation, hostname changes mid-flight)
        self._refresh_identity()
        # Convert internal snake_case keys to server-expected camelCase
        # (buffer_event uses snake_case kwargs, server Zod schema uses camelCase)
        server_events = []
        for ev in self.event_buffer:
            server_events.append({
                "eventType": ev.get("event_type") or ev.get("eventType"),
                "severity": ev["severity"],
                "source": ev["source"],
                "message": ev["message"],
                "rawData": ev.get("raw_data") if ev.get("raw_data") is not None else ev.get("rawData"),
                "eventTime": ev["eventTime"],
            })
        body_obj = {
            "version": VERSION,
            "events": server_events,
            "stats": get_system_stats(),
        }
        # Always include identity block on EVERY heartbeat so server tracks
        # hostname/IP changes (DHCP, IP rotation, multi-NIC). Even empty
        # identity gets sent — server detects "no identity" vs "stale data".
        body_obj["identity"] = self._identity or {}
        body = json.dumps(body_obj)
        sig = sign_body(self.secret_token, body)
        headers = {
            "X-Openshield-Agent-Id": self.agent_id,
            "X-Openshield-Agent-Signature": sig,
        }
        ok, data = self._request("POST", "/api/agents/heartbeat", body, headers)
        if ok:
            stats = data.get("stats", {})
            self.log.info(
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
                # 3. Log tailer (SSH brute force detection etc.)
                for ev in self.logtailer.tick():
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
            # Save log tailer state so we resume from the right offset
            try:
                self.logtailer._save_state()
            except Exception:
                pass


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
