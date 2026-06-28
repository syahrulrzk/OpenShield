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

VERSION = "1.6.1"
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

    The server-side destination port (sshd listen port) is detected at
    init time via `sshd -T` (preferred, gets effective config) with a
    fallback to scanning /etc/ssh/sshd_config and /etc/ssh/sshd_config.d/*.conf.
    If detection fails entirely, defaults to 22 (the IANA-registered SSH port).
    Detected port is attached to every event as raw_data.serverPort so the
    dashboard shows the correct port even when the log line itself doesn't
    carry the server-side port (only client source port is in the log).
    """

    @staticmethod
    def detect_sshd_port(log: Optional[logging.Logger] = None) -> int:
        """
        Detect the SSH daemon listen port on this host.

        Strategy (in order):
        1. `sshd -T` — sshd's own effective-config dump (most accurate,
           resolves Match blocks, includes, drop-ins). Requires /usr/sbin/sshd
           to be readable+executable by the agent process.
        2. Scan /etc/ssh/sshd_config + /etc/ssh/sshd_config.d/*.conf for
           `Port N` directives. Uses the FIRST explicit Port line; later
           lines are silently ignored by sshd.
        3. Default to 22.

        Returns: detected port number (1-65535), or 22 on any failure.
        Never raises — all exceptions are caught and logged at DEBUG.
        """
        # 1. sshd -T (most reliable)
        try:
            import subprocess
            sshd_paths = ("/usr/sbin/sshd", "/sbin/sshd", "sshd")
            sshd_bin = next((p for p in sshd_paths if os.path.isabs(p) and os.access(p, os.X_OK)) or ("sshd",))
            out = subprocess.run(
                [sshd_bin, "-T"],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
            if out.returncode == 0:
                for line in out.stdout.splitlines():
                    line = line.strip().lower()
                    if line.startswith("port "):
                        port = int(line.split()[1])
                        if 1 <= port <= 65535:
                            if log:
                                log.debug("SshdParser: detected SSH port %d via `sshd -T`", port)
                            return port
        except Exception as e:
            if log:
                log.debug("SshdParser: `sshd -T` failed (%s), falling back to config scan", e)

        # 2. Scan sshd_config + drop-ins
        try:
            import glob as _glob
            paths = ["/etc/ssh/sshd_config"] + sorted(_glob.glob("/etc/ssh/sshd_config.d/*.conf"))
            for path in paths:
                try:
                    with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                        for line in fh:
                            s = line.strip()
                            if not s or s.startswith("#"):
                                continue
                            m = re.match(r"^[Pp]ort\s+(\d+)", s)
                            if m:
                                port = int(m.group(1))
                                if 1 <= port <= 65535:
                                    if log:
                                        log.debug("SshdParser: detected SSH port %d from %s", port, path)
                                    return port
                except (FileNotFoundError, PermissionError):
                    continue
        except Exception as e:
            if log:
                log.debug("SshdParser: config scan failed (%s), falling back to 22", e)

        # 3. Default
        if log:
            log.debug("SshdParser: no SSH port detected, defaulting to 22")
        return 22

    def __init__(self, sshd_port: int = 22):
        """
        :param sshd_port: SSH daemon listen port detected at agent startup.
                          Used as default `serverPort` for events whose log
                          lines don't carry the server-side port explicitly.
                          For sshd.connection events (which DO have it in
                          the log), the explicit value wins.
        """
        self.sshd_port = sshd_port

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
    # 2026-06-21 fix: VERBOSE sshd format is "Connection closed by IP port PORT" (no user).
    # Old INFO format was "Connection closed by user USER IP port PORT" or with
    # "authenticating user" prefix. Pattern is fragile. Use a more lenient regex
    # that matches IP+port anchor and makes user truly optional.
    RE_CONN_CLOSED = re.compile(
        r"Connection closed by "
        r"(?:authenticating\s+user\s+(?P<user>\S+)\s+)?"
        r"(?:invalid\s+user\s+(?P<invaliduser>\S+)\s+)?"
        r"(?:user\s+(?P<user2>\S+)\s+)?"
        r"(?P<ip>[\d.]+)\s+port\s+(?P<port>\d+)"
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
    # SCP over SSH comes in two flavors:
    #   Legacy: "Starting session: subsystem 'scp' for rizki from 1.2.3.4 port 22 id 0"
    #   Modern (OpenSSH 9.0+): "Starting session: command scp -t /tmp for rizki from 1.2.3.4 port 22 id 1"
    # Both must classify as sshd.scp_session for proper audit.
    RE_SCP_SESSION = re.compile(
        r"Starting session: (?:subsystem 'scp'|command scp(?:\s+\S+)*?) for (\S+) from ([\d.]+) port (\d+)"
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
                    "serverPort": self.sshd_port,  # SSH server port (implicit in auth.log)
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
                    "serverPort": self.sshd_port,  # SSH server port (implicit; not in log line)
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
                    "port": int(port),       # client source port (ephemeral, random per conn)
                    "serverPort": self.sshd_port,  # SSH server port (detected at agent init)
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
                    "port": int(port),       # client source port (ephemeral, random per conn)
                    "serverPort": self.sshd_port,  # SSH server port (detected at agent init)
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
                    "serverPort": self.sshd_port,  # SSH server port (implicit; not in log line)
                    "parser": "sshd",
                },
            }
        m = self.RE_CONN_CLOSED.search(line)
        if m:
            # user may be missing (VERBOSE format), or be a real user, or
            # be an "invalid user" attempt — we capture the user from any
            # of those variants.
            user = (
                m.group("user")
                or m.group("user2")
                or m.group("invaliduser")
            )
            ip = m.group("ip")
            port = m.group("port")
            return {
                "event_type": "log.line",
                "severity": "INFO",
                "source": "/var/log/auth.log",
                "message": f"SSH connection closed: user={user or '?'}, ip={ip}",
                "raw_data": {
                    "event": "sshd.conn_closed",
                    "user": user,  # may be None for VERBOSE format
                    "ip": ip,
                    "port": int(port) if port else None,
                    "serverPort": self.sshd_port,  # SSH server port (implicit in auth.log)
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
                    "serverPort": self.sshd_port,  # SSH server port (implicit in auth.log)
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
                    "serverPort": self.sshd_port,  # SSH server port (implicit in auth.log)
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
                    "serverPort": self.sshd_port,  # SSH server port (implicit in auth.log)
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
                    "serverPort": self.sshd_port,  # SSH server port (implicit in auth.log)
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
                    "serverPort": self.sshd_port,  # SSH server port (implicit in log)
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


class MysqlAuditParser:
    """
    Parse MySQL audit log lines (general_log in FILE mode).

    Output file format depends on `log_output` setting:
      - FILE mode: `/var/log/mysql/<hostname>.log` — syslog-style plain text
      - TABLE mode: `mysql.general_log` — queryable but agent doesn't read it
        (server-side poller does that for assets with auditConnectionLog=true).

    For FILE mode, each line looks like:
      /usr/sbin/mysqld, Version: 8.0.46 (MySQL Community Server - GPL). started with:
      Tcp port: 3306  Unix socket: /var/run/mysqld/mysqld.sock
      Time                 Id Command    Argument
      2026-06-21T07:03:34.896750Z   188 Connect   Access denied for user 'openshield'@'172.16.19.235' (using password: YES)
      2026-06-21T07:03:35.123456Z   189 Connect   openshield@172.16.19.235 on app_prod using TCP/IP
      2026-06-21T07:04:00.000000Z   190 Quit

    We ONLY capture: Connect (success + Access denied), Quit.
    Query / Init / Statistics / etc. are skipped — privacy + perf.

    Emits 'log.line' events with severity:
      - ERROR: Access denied (failed login)
      - INFO:  successful connect, disconnect

    Setup on target MySQL server:
      SET GLOBAL log_output = 'FILE';   -- or 'TABLE' for server-side polling
      SET GLOBAL general_log  = 'ON';
      -- Rotate via logrotate or systemd timer; agent tails actively.
    """

    # 2026-06-21T07:03:35.123456Z   188 Connect   <argument...>
    RE_CONNECT_DENIED = re.compile(
        r"^(\S+)\s+\d+\s+Connect\s+Access denied for user '([^']+)'@'([^']+)'"
        r"(?:\s+\(using password: (YES|NO)\))?"
    )
    # 2026-06-21T07:03:35.123456Z   188 Connect   <user>@<host> on <db> using <protocol>
    RE_CONNECT_OK = re.compile(
        # Connect lines come in 3 flavors:
        #   1. <user>@<host> on <db> using <proto>      (local conn, picked a DB)
        #   2. <user>@<host> on  using <proto>          (local conn, no DB picked — `on ` followed by space)
        #   3. <user>@<host> using <proto>              (auth-only path)
        # The DB group is optional and may be empty.
        r"^(\S+)\s+\d+\s+Connect\s+([^\s@]+)@([^\s]+?)(?:\s+on(?:\s+(\S*))?)?(?:\s+using\s+\S+)?\s*$"
    )
    # 2026-06-21T07:04:00.000000Z   190 Quit
    RE_QUIT = re.compile(
        r"^(\S+)\s+\d+\s+Quit\s*$"
    )

    def __init__(self):
        pass

    # MySQL general_log lines look like:
    #   <timestamp>\t<id> <command>\t<argument>
    # Commands of interest: Connect, Quit. Others (Query, Init, Statistics, ...)
    # are skipped per Bos (privacy + performance).
    RE_COMMAND = re.compile(r"\s(Connect|Quit)\s")

    def parse(self, line: str) -> Optional[Dict[str, Any]]:
        line = line.rstrip("\n")
        if not line:
            return None

        # Skip Query / Init / Statistics etc. explicitly (privacy + perf per Bos)
        if " Query\t" in line or " Init\t" in line or " Statistics\t" in line:
            return None
        # Skip the banner / header lines (start with "/" or "Time")
        if line.startswith("/") or line.startswith("Time ") or line.startswith("Tcp port"):
            return None

        # Only process lines that are Connect or Quit events
        if not self.RE_COMMAND.search(line):
            return None

        m = self.RE_CONNECT_DENIED.match(line)
        if m:
            ts, username, source_ip, pwd_used = m.groups()
            return self._event(
                ts=ts,
                severity="ERROR",
                event_type="mysql.connect.failed",
                username=username,
                source_ip=source_ip,
                database=None,
                extra={
                    "passwordUsed": pwd_used == "YES",
                    "service": "MYSQL",
                    "parser": "mysql_audit",
                    "source": "/var/lib/mysql/reborn.log",
                },
                raw_excerpt=f"Access denied for '{username}'@'{source_ip}'",
            )

        m = self.RE_CONNECT_OK.match(line)
        if m:
            ts, username, source_ip, database = m.groups()
            return self._event(
                ts=ts,
                severity="INFO",
                event_type="mysql.connect.success",
                username=username,
                source_ip=source_ip,
                database=database,
                extra={
                    "service": "MYSQL",
                    "parser": "mysql_audit",
                    "source": "/var/lib/mysql/reborn.log",
                },
                raw_excerpt=f"connect {username}@{source_ip} on {database or '-'}",
            )

        m = self.RE_QUIT.match(line)
        if m:
            ts = m.group(1)
            # Quit events don't carry user@host in general_log — emit minimal event
            return self._event(
                ts=ts,
                severity="INFO",
                event_type="mysql.disconnect",
                username=None,
                source_ip=None,
                database=None,
                extra={
                    "service": "MYSQL",
                    "parser": "mysql_audit",
                    "source": "/var/lib/mysql/reborn.log",
                },
                raw_excerpt="connection closed",
            )

        return None

    @staticmethod
    def _event(ts, severity, event_type, username, source_ip, database, extra, raw_excerpt):
        # Returns dict matching buffer_event() keyword signature:
        #   (event_type, severity, source, message, raw_data)
        # buffer_event adds eventTime = now() automatically.
        # The original log timestamp `ts` is preserved in raw_data for the server.
        return {
            "event_type": "log.line",
            "severity": severity,
            "source": extra.get("source", "/var/log/mysql/mysql-audit.log"),
            "message": raw_excerpt,
            "raw_data": {
                "event": canonical_event,
                "username": username,
                "ip": source_ip,
                "database": database,
                "message": raw_excerpt,
                "eventTime": ts,
                **extra,
            },
        }


class PgAuditParser:
    """
    Parse PostgreSQL pgaudit log lines.

    pgaudit emits structured log entries when configured. Format (CSV-ish):
      2026-06-21 14:03:00 UTC [unknown] postgres [unknown] db_prod [unknown] LOG:
        AUDIT: SESSION,1,1,READ,SELECT,TABLE,public.users,"SELECT * FROM users WHERE id=1"
      2026-06-21 14:04:00 UTC [unknown] postgres [unknown] db_prod [unknown] LOG:
        AUDIT: SESSION,2,1,WRITE,INSERT,TABLE,public.users,...

    For connection events, pgaudit with `pgaudit.log='connection'` emits:
      2026-06-21 14:05:00 UTC [unknown] dbuser [unknown] db_prod [192.168.1.5] LOG:
        AUDIT: SESSION,3,1,CONNECT,,,,"user=dbuser,db=db_prod,client=192.168.1.5"
      2026-06-21 14:06:00 UTC [unknown] dbuser [unknown] db_prod [192.168.1.5] LOG:
        AUDIT: SESSION,4,1,DISCONNECT,,,,

    We capture CONNECT + DISCONNECT + failed authentication only.
    Skipping SESSION/READ/WRITE/SELECT/INSERT/UPDATE/DELETE per Bos (slow query noise).

    Setup on target PostgreSQL server:
      shared_preload_libraries = 'pgaudit'         -- postgresql.conf
      pgaudit.log = 'connection'                   -- log only connect/disconnect
      -- Or for full: pgaudit.log = 'ddl, role, write, read'
      CREATE EXTENSION IF NOT EXISTS pgaudit;      -- per-database

    Emits 'log.line' events with severity:
      - ERROR: failed authentication (parse hint: user@ip in denial line)
      - INFO:  successful connect, disconnect
    """

    # 2026-06-21 14:05:00 UTC [unknown] dbuser [unknown] db_prod [192.168.1.5] LOG: AUDIT: SESSION,3,1,CONNECT,,,,"user=dbuser,db=db_prod"
    RE_PGAUDIT_EVENT = re.compile(
        r"^(\S+)\s+\S+\s+\[unknown\]\s+(\S+)\s+\[unknown\]\s+(\S+)"
        r"\s+\[([^\]]+)\]\s+LOG:\s+AUDIT:\s+SESSION,\d+,\d+,(\w+),"
    )

    def __init__(self):
        pass

    def parse(self, line: str) -> Optional[Dict[str, Any]]:
        line = line.rstrip("\n")
        if "AUDIT:" not in line:
            return None
        # Skip SESSION with non-connect actions (READ/WRITE/DDL/ROLE/etc.)
        # per Bos (slow query noise)
        if any(action in line for action in ("READ,", "WRITE,", "DDL,", "ROLE,", "MISC,")):
            return None

        m = self.RE_PGAUDIT_EVENT.search(line)
        if not m:
            return None

        ts, username, database, source_ip, action = m.groups()

        if action == "CONNECT":
            return self._event(
                ts=ts,
                severity="INFO",
                event_type="pg.connect.success",
                username=username,
                source_ip=source_ip,
                database=database,
                extra={"service": "POSTGRES", "parser": "pgaudit", "source": "/var/log/postgresql/pgaudit.log"},
                raw_excerpt=f"connect {username}@{source_ip} db={database}",
            )
        elif action == "DISCONNECT":
            return self._event(
                ts=ts,
                severity="INFO",
                event_type="pg.disconnect",
                username=username,
                source_ip=source_ip,
                database=database,
                extra={"service": "POSTGRES", "parser": "pgaudit", "source": "/var/log/postgresql/pgaudit.log"},
                raw_excerpt=f"disconnect {username}@{source_ip}",
            )
        elif action == "FAILED_AUTH" or action == "AUTH_FAILED":
            return self._event(
                ts=ts,
                severity="ERROR",
                event_type="pg.connect.failed",
                username=username,
                source_ip=source_ip,
                database=database,
                extra={"service": "POSTGRES", "parser": "pgaudit", "source": "/var/log/postgresql/pgaudit.log"},
                raw_excerpt=f"auth failed {username}@{source_ip}",
            )
        # Other actions (READ, WRITE, DDL, ROLE, etc.) — skipped per Bos
        return None

    @staticmethod
    def _event(ts, severity, event_type, username, source_ip, database, extra, raw_excerpt):
        # Returns dict matching buffer_event() keyword signature:
        #   (event_type, severity, source, message, raw_data)
        # buffer_event adds eventTime = now() automatically.
        # The original log timestamp `ts` is preserved in raw_data for the server.
        return {
            "event_type": "log.line",
            "severity": severity,
            "source": extra.get("source", "/var/log/mysql/mysql-audit.log"),
            "message": raw_excerpt,
            "raw_data": {
                "event": canonical_event,
                "username": username,
                "ip": source_ip,
                "database": database,
                "message": raw_excerpt,
                "eventTime": ts,
                **extra,
            },
        }


class SyslogParser:
    """
    Parse Linux syslog (/var/log/syslog, /var/log/messages) lines.

    Supports two formats:
      1. RFC 5424: "<PRI>VERSION SP TIMESTAMP SP HOSTNAME SP APPNAME PROCID MSGID MSG"
         Example: "<165>1 2003-10-11T22:14:15.003Z mymachine.example.com evntslog - ID47 BOMAn application event log entry..."
      2. RFC 3164 (legacy/BSD): "TIMESTAMP HOSTNAME TAG[PID]: MESSAGE"
         Example: "Jun 22 07:36:01 reborn sshd[12345]: Failed password for root from 1.2.3.4 port 22 ssh2"

    Severity mapping (RFC 5424 §6.1.1):
      0 emerg    → ERROR
      1 alert    → ERROR
      2 crit     → ERROR
      3 err      → ERROR
      4 warning  → WARN
      5 notice   → INFO
      6 info     → INFO
      7 debug    → INFO

    Auth/security pattern detection (severity upgrade):
      - sshd lines mentioning auth (Failed password, Invalid user, Accepted, Disconnecting, Connection closed)
      - sudo / su / pam_unix messages
      - useradd / usermod / groupadd / passwd / chpasswd changes
      - polkit / pkexec privilege events

    Default noise filter (these sources are skipped unless they match an auth pattern):
      - rsyslogd, systemd, kernel, cron, CRON, anacron, chronyd, ntpd, dhclient,
        dbus-daemon, NetworkManager, wpa_supplicant, avahi-daemon

    Emits 'log.line' events with:
      - severity from syslog priority (mapped to ERROR/WARN/INFO)
      - eventType from auth pattern detection if matched, else 'syslog.line'
      - raw_data includes: priority, facility, source_app, pid, message, parser='syslog'
    """

    import re

    # ─────────────────────────────────────────────────────────────────────
    # RFC 5424 PRI header: <NNN>
    # ─────────────────────────────────────────────────────────────────────
    RE_PRI = re.compile(r'^<(\d{1,3})>')

    # ─────────────────────────────────────────────────────────────────────
    # RFC 3164 / BSD header: "Mon DD HH:MM:SS HOSTNAME TAG[PID]: MESSAGE"
    # (some systems use ISO timestamp here too)
    # ─────────────────────────────────────────────────────────────────────
    RE_BSD = re.compile(
        r'^(?P<ts>(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)|'
        r'(?:[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}))\s+'
        r'(?P<host>\S+)\s+'
        r'(?P<tag>[^\s\[:]+)(?:\[(?P<pid>\d+)\])?:\s*'
        r'(?P<msg>.*)$'
    )

    # ─────────────────────────────────────────────────────────────────────
    # RFC 5424 MSG (after PRI stripped): "VERSION TIMESTAMP HOSTNAME APPNAME PROCID MSGID MSG"
    # VERSION is single digit, TIMESTAMP is ISO8601
    # ─────────────────────────────────────────────────────────────────────
    RE_RFC5424 = re.compile(
        r'^\d+\s+'                              # VERSION
        r'(?P<ts>\S+)\s+'                       # TIMESTAMP (ISO)
        r'(?P<host>\S+)\s+'                     # HOSTNAME
        r'(?P<app>\S+)\s+'                      # APPNAME
        r'(?P<proc>\S+)\s+'                     # PROCID
        r'\S+\s+'                               # MSGID
        r'(?:\[(?P<sd>.*?)\]\s*)?'              # optional STRUCTURED-DATA
        r'(?P<msg>.*)$'                         # MSG
    )

    # ─────────────────────────────────────────────────────────────────────
    # Noisy apps/services to skip by default (unless they match an auth pattern)
    # ─────────────────────────────────────────────────────────────────────
    NOISE_SOURCES = frozenset({
        # System / init
        'rsyslogd', 'systemd', 'systemd-logind', 'systemd-networkd',
        'systemd-resolved', 'systemd-udevd', 'systemd-timesyncd',
        'kernel', 'cron', 'CRON', 'anacron',
        'chronyd', 'ntpd', 'ntpdate', 'systemd-timedated',
        'dhclient', 'NetworkManager', 'wpa_supplicant',
        'dbus-daemon', 'avahi-daemon', 'cupsd', 'bolt',
        'thermald', 'snapd', 'packagekitd', 'unattended-upgrades',
        'motd-news', 'ssh-agent',
        # Container / virtualization
        'dockerd', 'containerd', 'docker', 'kubelet',
        # OpenShield itself (agent + dev server)
        'python3', 'openshield-dev', 'next-server', 'prisma',
        # Generic logger wrapper
        'root',
        # systemd unit error prefix
        '(node)', '(uomi)',
        # 2026-06-22: Network/filesystem noise (high volume, low signal)
        'tailscaled',           # Tailscale VPN — periodic status pings
        'nmbd', 'smbd',         # Samba — name/service broadcasts
        'gpg-agent', 'gcr-prompter', 'gnome-keyring', 'gnome-keyring-d',
        'augenrules',           # audit rules loader — loads on boot
        'Tor',                  # Tor daemon — circuits handshakes
        'polkitd', 'polkit-agent-helper',  # polkit — frequent auth checks
        'accounts-daemon',
    })

    # ─────────────────────────────────────────────────────────────────────
    # Auth/security patterns. NOTE: BSD parser strips "app[pid]:" prefix
    # before applying these, so patterns are PURE MESSAGE BODY only.
    # ─────────────────────────────────────────────────────────────────────
    AUTH_PATTERNS = (
        # sshd
        (re.compile(r'\b(?:Failed password|Invalid user|Accepted (?:password|publickey) for|Disconnecting|Connection (?:closed|reset)|error:\s*maximum authentication|reverse mapping checking|message repeated)', re.IGNORECASE), 'syslog.sshd', 'ERROR'),
        # sudo
        (re.compile(r'(?:COMMAND=|authentication failure|incorrect password attempts|user NOT in sudoers|problem with defaults entries)', re.IGNORECASE), 'syslog.sudo', 'WARN'),
        # su
        (re.compile(r'pam_unix\(su:|su\[\d+\]:', re.IGNORECASE), 'syslog.su', 'WARN'),
        # PAM generic (only session opened/closed or failures)
        (re.compile(r'pam_unix\(\S+\):\s*(?:authentication failure|check pass; user unknown|session opened|session closed|account expired)', re.IGNORECASE), 'syslog.pam', 'WARN'),
        # user/group/passwd changes
        (re.compile(r'\b(?:new user|user (?:added|removed|modified|changed)|password (?:changed|updated)|group (?:added|removed|modified)|chpasswd)', re.IGNORECASE), 'syslog.user_change', 'WARN'),
        # polkit / pkexec privilege escalation
        (re.compile(r'(?:Authentication (?:failed|denied) for|not authorized|polkit:|operator (?:NOT|unauthorized))', re.IGNORECASE), 'syslog.privilege', 'WARN'),
        # login session lifecycle
        (re.compile(r'\b(?:FAILED LOGIN|session (?:opened|closed) for user)', re.IGNORECASE), 'syslog.session', 'INFO'),
    )

    # ─────────────────────────────────────────────────────────────────────
    # Non-auth security-relevant category patterns.
    # Maps each category → list of (regex, event_type, severity).
    # These run AFTER AUTH_PATTERNS (auth has priority) but BEFORE the noise
    # filter, so events matching these categories are kept even from "noisy"
    # sources like systemd/cron/dockerd.
    # ─────────────────────────────────────────────────────────────────────

    # 🔧 Service / systemd events
    # NOTE: BSD parser already strips "systemd[1]:" prefix, so patterns match
    # the PURE message body. RFC 5424 lines preserve the full form.
    SERVICE_PATTERNS = (
        # systemd: "Started nginx.service." / "Stopped nginx.service." etc
        (re.compile(r'\b(?:Started|Stopped|Failed|Reloaded|Reached target|Stopped target|Started session)\s+[^\s.]+\.', re.IGNORECASE), 'syslog.service.started', 'INFO'),
        # service failed specifically (high signal)
        (re.compile(r'\.service:\s*(?:Main process exited|Failed with result|Unit entered failed state|Scheduled restart job|start request repeated too quickly)', re.IGNORECASE), 'syslog.service.failed', 'ERROR'),
        # service stopped (was running)
        (re.compile(r'\bStopped\s+[^\s.]+\.', re.IGNORECASE), 'syslog.service.stopped', 'WARN'),
    )

    # ⏰ Cron / scheduled task events
    # NOTE: BSD parser already strips "CRON[1234]:" prefix.
    CRON_PATTERNS = (
        # CRON: "(root) CMD /path/to/command" — actual command run
        (re.compile(r'\(?\S+\)?\s+CMD\s+\S+', re.IGNORECASE), 'syslog.cron.job', 'INFO'),
        # crontab edited (persistence indicator!)
        (re.compile(r'\b(?:REPLACE|CRONTAB_CMD|LIST\s+\S+|END\s+EDIT)', re.IGNORECASE), 'syslog.cron.edit', 'WARN'),
        # anacron / at scheduled jobs
        (re.compile(r'\b(?:anacron|at)\[\d+\]:\s+(?:Jobs will be executed|Will run job|Job `?)', re.IGNORECASE), 'syslog.cron.scheduled', 'INFO'),
    )

    # 🌐 Network events (interface, firewall, DHCP)
    NETWORK_PATTERNS = (
        # NetworkManager / systemd-networkd: link state
        # Interface name can be eth0 (digit) OR ethXXX OR br0 OR vethXYZ
        (re.compile(r'\b(?:state change|connected|disconnected|link\s+(?:\w+\s+)?(?:up|down)|activation|carrier (?:on|off)|new\s+IPv[46]?\s+address|connection (?:activated|deactivated))\b', re.IGNORECASE), 'syslog.network.link', 'INFO'),
        # iptables / nftables / ufw blocked
        (re.compile(r'\b(?:DROP|BLOCK|REJECT|DENY)\b.*?\b(?:SRC=|IN=|OUT=)', re.IGNORECASE), 'syslog.firewall.blocked', 'WARN'),
        # DHCP
        (re.compile(r'\b(?:DHCP(?:ACK|REQUEST|DISCOVER|NAK|RELEASE)|lease (?:obtained|expired|renewed))', re.IGNORECASE), 'syslog.network.dhcp', 'INFO'),
    )

    # 🐳 Container events (Docker, containerd, kubelet, podman)
    # NOTE: Listed LAST in category check order because its patterns are
    # broadest. More specific patterns (disk/kernel/service) take priority.
    DOCKER_PATTERNS = (
        # dockerd: container lifecycle (after app[pid]: stripped, just check verb)
        (re.compile(r'\bcontainer\s+(?:start|stop|die|kill|destroy|create|pause|unpause|restart|rename|attach|detach|exec)\b', re.IGNORECASE), 'syslog.docker.container', 'INFO'),
        # image ops
        (re.compile(r'\bimage\s+(?:pull|push|load|save|tag|untag|remove|import|export)\b', re.IGNORECASE), 'syslog.docker.container', 'INFO'),
        # docker daemon-specific errors (NOT generic error/denied which would
        # over-match and steal events from disk/kernel/etc categories)
        (re.compile(r'\b(?:Error response from daemon|docker\.sock|no such (?:container|image|network|volume)|conflict: container name|already in use by container)', re.IGNORECASE), 'syslog.docker.error', 'ERROR'),
    )

    # 💾 Disk / hardware / kernel events
    DISK_PATTERNS = (
        # disk full / no space
        (re.compile(r'\b(?:No space left on device|disk full|ENOSPC|filesystem full|out of disk space|inode (?:full|exhausted))', re.IGNORECASE), 'syslog.disk.full', 'ERROR'),
        # disk I/O errors
        (re.compile(r'\b(?:I/O error|medium error|blk_update_request|sector|bad block|read-only filesystem|EXT4-fs error|XFS .* error)', re.IGNORECASE), 'syslog.disk.error', 'ERROR'),
        # USB / hardware hotplug
        (re.compile(r'\b(?:usb \d+-\d+:\s*new|usb \d+-\d+:.*?(?:disconnect|reset)|new USB device found|input:.*USB)', re.IGNORECASE), 'syslog.usb.device', 'INFO'),
    )

    KERNEL_PATTERNS = (
        # kernel panic / oops
        (re.compile(r'\b(?:kernel panic|Oops:|BUG:|general protection fault|kernel:.*Call Trace|kernel:.*RIP:|kernel BUG at)', re.IGNORECASE), 'syslog.kernel.panic', 'ERROR'),
        # segfault
        (re.compile(r'\bsegfault at \w+ ip \w+ sp \w+ error \d+', re.IGNORECASE), 'syslog.kernel.segfault', 'ERROR'),
        # hardware errors (mcelog, EDAC, etc)
        (re.compile(r'\b(?:Machine Check Exception|mce:\|Hardware error|MCE:\s+[0-9]|EDAC)', re.IGNORECASE), 'syslog.hardware.error', 'ERROR'),
    )

    # Package management (apt/yum/dnf) — persistence indicator
    PACKAGE_PATTERNS = (
        # apt installed / removed / configured / upgraded
        (re.compile(r'\b(?:Setting up|Get:\d+|Unpacking|Preparing to unpack|Reading database|apt-get|yum|dnf|apk|pacman|zypper)\b', re.IGNORECASE), 'syslog.package.install', 'INFO'),
        # dpkg action lines: "install", "remove", "purge", "configure"
        (re.compile(r'\b(?:install|remove|purge|configure|upgrade|downgrade)\s+[a-z][\w.+-]+\s+(?:[\d.:+~a-z-]+)?\s*$', re.IGNORECASE), 'syslog.package.install', 'INFO'),
    )

    # 🚀 Boot / shutdown / reboot events (systemd, kernel)
    # High-signal lifecycle events that mark host restarts.
    BOOT_PATTERNS = (
        # systemd: "Startup finished in 1.2s." / "Boot finished at 12345."
        (re.compile(r'\b(?:Startup finished|Boot finished|Startup of \d+ took|Reached target (?:Multi-User|System|Graphical|Network|Local File Systems)|Reached (?:login|graphical) target)\b', re.IGNORECASE), 'syslog.boot.started', 'INFO'),
        # systemd: "System Initialization started." / "Started Initial Setup."
        (re.compile(r'\bSystem (?:Initialization|Shutdown|Reboot)\b', re.IGNORECASE), 'syslog.boot.lifecycle', 'WARN'),
        # kernel: "Linux version ... starting" / "Command line: BOOT_IMAGE=..."
        (re.compile(r'\b(?:Linux version|Command line:|Kernel command line:|Run /sbin/init as init process|Kernel started|scanning \d+ directories)', re.IGNORECASE), 'syslog.boot.kernel', 'INFO'),
        # shutdown: "Shutting down." / "Reached target Shutdown." / "Powering off."
        (re.compile(r'\b(?:Shutting down|Powering off|Halting system|Reached target (?:Shutdown|PowerOff)|System halted|Going down for|systemd-shutdown)', re.IGNORECASE), 'syslog.boot.shutdown', 'WARN'),
    )

    # ─────────────────────────────────────────────────────────────────────
    # Category mapping: eventType prefix → UI category
    # Used by UI/API to group events in the dashboard.
    # ─────────────────────────────────────────────────────────────────────
    CATEGORY_MAP = {
        'syslog.sshd': 'auth',
        'syslog.sudo': 'auth',
        'syslog.su': 'auth',
        'syslog.pam': 'auth',
        'syslog.user_change': 'user',
        'syslog.privilege': 'auth',
        'syslog.session': 'auth',
        'syslog.service': 'service',
        'syslog.cron': 'cron',
        'syslog.network': 'network',
        'syslog.firewall': 'network',
        'syslog.docker': 'docker',
        'syslog.kubernetes': 'docker',
        'syslog.disk': 'disk',
        'syslog.usb': 'hardware',
        'syslog.kernel': 'kernel',
        'syslog.hardware': 'hardware',
        'syslog.package': 'package',
        'syslog.boot': 'system',
        'syslog.line': 'system',
        'syslog.malformed': 'system',
    }

    @classmethod
    def get_category(cls, event_type: str) -> str:
        """Return UI category for an event type, e.g. 'syslog.sshd' → 'auth'."""
        for prefix, cat in cls.CATEGORY_MAP.items():
            if event_type.startswith(prefix):
                return cat
        return 'other'

    # Map RFC 5424 severity (0-7) → our canonical severity
    SEVERITY_MAP = {
        0: 'ERROR',  # emerg
        1: 'ERROR',  # alert
        2: 'ERROR',  # crit
        3: 'ERROR',  # err
        4: 'WARN',   # warning
        5: 'INFO',   # notice
        6: 'INFO',   # info
        7: 'INFO',   # debug
    }

    SEVERITY_NAMES = {
        0: 'emerg', 1: 'alert', 2: 'crit', 3: 'err',
        4: 'warning', 5: 'notice', 6: 'info', 7: 'debug',
    }

    BRUTE_FORCE_WINDOW_S = 60
    BRUTE_FORCE_THRESHOLD = 5

    def __init__(self, source_path: str = '/var/log/syslog'):
        self.source_path = source_path
        # IP → deque of monotonic timestamps (seconds since epoch) for
        # the BRUTE_FORCE_WINDOW_S rolling window.
        import collections as _collections
        self._ssh_failures: Dict[str, _collections.deque] = {}

    def _record_ssh_failure(self, ip: str, ts: float) -> int:
        """
        Record one sshd failed auth attempt for `ip` at `ts` (seconds).
        Returns the current count of failures for `ip` within the window.
        Auto-prunes entries older than BRUTE_FORCE_WINDOW_S.
        """
        import collections as _collections
        dq = self._ssh_failures.get(ip)
        if dq is None:
            dq = _collections.deque()
            self._ssh_failures[ip] = dq
        dq.append(ts)
        cutoff = ts - self.BRUTE_FORCE_WINDOW_S
        while dq and dq[0] < cutoff:
            dq.popleft()
        return len(dq)

    def parse(self, line: str) -> Optional[Dict[str, Any]]:
        line = line.rstrip('\n')
        if not line:
            return None

        # ── Step 1: extract PRI (RFC 5424) if present ─────────────────────
        pri = None
        m_pri = self.RE_PRI.match(line)
        if m_pri:
            pri = int(m_pri.group(1))
            line = self.RE_PRI.sub('', line, count=1)
            facility = pri >> 3
            severity_num = pri & 0x07
        else:
            facility = None
            severity_num = None

        # ── Step 2: parse header. Try BSD first; if no PRI was given,
        #             fall back to RFC 5424 structure.
        m_bsd = self.RE_BSD.match(line)
        if m_bsd:
            app = m_bsd.group('tag')
            pid = m_bsd.group('pid')
            msg = m_bsd.group('msg')
            line_format = 'bsd'
        elif pri is not None:
            # Had PRI, BSD regex didn't match → must be RFC 5424
            m_5424 = self.RE_RFC5424.match(line)
            if m_5424:
                app = m_5424.group('app')
                pid = m_5424.group('proc')
                msg = m_5424.group('msg')
                line_format = 'rfc5424'
            else:
                # PRI but malformed MSG — emit as malformed
                return self._make_event(
                    severity='INFO',
                    event_type='syslog.malformed',
                    source_app='unknown',
                    pid=None,
                    message=line[:500],
                    raw={
                        'parser': 'syslog',
                        'priority': pri,
                        'facility': facility,
                        'severityNum': severity_num,
                        'severityName': self.SEVERITY_NAMES.get(severity_num),
                        'sourceApp': 'unknown',
                        'pid': None,
                        'eventKind': 'syslog.malformed',
                        'authDetected': False,
                        'note': 'malformed_rfc5424',
                    },
                )
        else:
            # No PRI, no BSD header → totally unparseable
            return self._make_event(
                severity='INFO',
                event_type='syslog.malformed',
                source_app='unknown',
                pid=None,
                message=line[:500],
                raw={
                    'parser': 'syslog',
                    'priority': None,
                    'facility': None,
                    'severityNum': None,
                    'severityName': None,
                    'sourceApp': 'unknown',
                    'pid': None,
                    'eventKind': 'syslog.malformed',
                    'authDetected': False,
                    'note': 'unparseable_header',
                },
            )

        # ── Step 3: detect auth/security pattern ─────────────────────────
        is_auth_event = False
        auth_event_type = None
        auth_severity = None
        for pattern, ev_type, ev_sev in self.AUTH_PATTERNS:
            if pattern.search(msg):
                is_auth_event = True
                auth_event_type = ev_type
                auth_severity = ev_sev
                break

        # ── Step 3.5: detect non-auth security-relevant category ──────────
        # These take priority over the generic 'syslog.line' fallback but
        # lose to AUTH_PATTERNS (security events are more important).
        # Order matters: specific patterns first (disk/kernel), broad patterns
        # last (docker) so we don't misclassify an "error" line as docker.
        category_event_type = None
        category_severity = None
        for patterns_tuple in (self.KERNEL_PATTERNS, self.DISK_PATTERNS,
                                self.SERVICE_PATTERNS, self.CRON_PATTERNS,
                                self.NETWORK_PATTERNS, self.PACKAGE_PATTERNS,
                                self.DOCKER_PATTERNS, self.BOOT_PATTERNS):
            for pattern, ev_type, ev_sev in patterns_tuple:
                if pattern.search(msg):
                    category_event_type = ev_type
                    category_severity = ev_sev
                    break
            if category_event_type:
                break

        # ── Step 4: noise filter (skip noisy sources unless auth/event) ──
        # Skip noise only if NOT auth and NOT in a tracked category.
        if app in self.NOISE_SOURCES and not is_auth_event and not category_event_type:
            return None

        # ── Step 5: determine severity ───────────────────────────────────
        if is_auth_event:
            severity = auth_severity
            event_type = auth_event_type
        elif category_event_type:
            severity = category_severity
            event_type = category_event_type
        elif severity_num is not None:
            severity = self.SEVERITY_MAP[severity_num]
            event_type = 'syslog.line'
        else:
            severity = 'INFO'
            event_type = 'syslog.line'

        pid_int = int(pid) if pid and pid.isdigit() else None

        # Extract user/IP once — used for both the main event AND the
        # brute-force correlation check below.
        user_ip = self._match_user_ip(msg, event_type or 'syslog.line')
        user_str = user_ip.get("user")
        ip_str = user_ip.get("ip")

        main_event = self._make_event(
            severity=severity,
            event_type=event_type,
            source_app=app,
            pid=pid_int,
            message=msg[:500],
            raw={
                'parser': 'syslog',
                'format': line_format,
                'priority': pri,
                'facility': facility,
                'severityNum': severity_num,
                'severityName': self.SEVERITY_NAMES.get(severity_num) if severity_num is not None else None,
                'sourceApp': app,
                'pid': pid_int,
                'eventKind': event_type,
                'authDetected': is_auth_event,
                # 2026-06-22: server event-log-router populates the
                # `process` column of t_event_log_syslog from rawData.process.
                # Without this alias the column stays NULL and the UI shows
                # no application/process label. (Same as SshdParser which
                # sets rawData.process from the matched tag.)
                'process': app,
                # 2026-06-22: extract user + ip from common syslog auth
                # patterns so the UI can display the flat columns Bos
                # wants (id, timestamp, agent, event_type, severity,
                # user, source_ip, description). Without this the view
                # would always show user=- and source_ip=-.
                **user_ip,
                # 2026-06-22: extract systemd unit name for service.* events
                # so server event-log-router can dedup a flapping service
                # (e.g. monitoring-agent restart-loop producing 30 events/min)
                # into a single row with growing count.
                **({"service": unit} if (unit := self._extract_service_unit(msg)) else {}),
            },
        )

        # ── Brute force correlation ───────────────────────────────────
        # 2026-06-22: when a syslog.sshd ERROR event has a parsed source IP
        # AND the message is a failure (Failed password / Invalid user),
        # record it. If we hit BRUTE_FORCE_THRESHOLD (5) failures within
        # BRUTE_FORCE_WINDOW_S (60s), emit an ADDITIONAL syslog.bruteforce
        # ERROR event so the dashboard / alerts page can surface the
        # attack pattern (one row instead of 5 identical rows).
        #
        # The event type is kept as syslog.bruteforce (NOT syslog.sshd)
        # so server event-log-router can route it to its own bucket and
        # a future severity filter / alert can target it specifically.
        extra_events = []
        if (
            event_type == 'syslog.sshd'
            and severity == 'ERROR'
            and ip_str
            and re.search(r'\b(?:Failed password|Invalid user)\b', msg, re.IGNORECASE)
        ):
            # 2026-06-22: use agent wall clock for correlation window.
            # syslog timestamp parsing adds complexity for marginal gain
            # (window is 60s, syslog→agent lag is sub-second).
            import time as _time
            ts = _time.time()
            count = self._record_ssh_failure(ip_str, ts)
            if count >= self.BRUTE_FORCE_THRESHOLD:
                # Only fire the alert once per WINDOW — check if we already
                # fired for this IP within the window.
                last_alert = getattr(self, '_ssh_last_alert', {}).get(ip_str)
                if not last_alert or (ts - last_alert) >= self.BRUTE_FORCE_WINDOW_S:
                    if not hasattr(self, '_ssh_last_alert'):
                        self._ssh_last_alert = {}
                    self._ssh_last_alert[ip_str] = ts
                    extra_events.append(
                        self._make_event(
                            severity='ERROR',
                            event_type='syslog.bruteforce',
                            source_app=app,
                            pid=pid_int,
                            message=(
                                f"Brute force suspected: {count} failed sshd attempts "
                                f"from {ip_str} in last {self.BRUTE_FORCE_WINDOW_S}s"
                            )[:500],
                            raw={
                                'parser': 'syslog',
                                'format': line_format,
                                'priority': pri,
                                'facility': facility,
                                'severityNum': severity_num,
                                'severityName': self.SEVERITY_NAMES.get(severity_num) if severity_num is not None else None,
                                'sourceApp': app,
                                'pid': pid_int,
                                'eventKind': 'syslog.bruteforce',
                                'authDetected': True,
                                'process': app,
                                'user': user_str,
                                'sourceIp': ip_str,
                                'bruteForceCount': count,
                                'windowSeconds': self.BRUTE_FORCE_WINDOW_S,
                            },
                        )
                    )

        if extra_events:
            return [main_event] + extra_events
        return main_event

        try:
            from datetime import datetime as _dt, timezone as _tz
            if isinstance(parsed_ts, _dt):
                if parsed_ts.tzinfo is None:
                    parsed_ts = parsed_ts.replace(tzinfo=_tz.utc)
                return parsed_ts.timestamp()
            if isinstance(parsed_ts, str):
                # ISO 8601 fallback — best effort.
                return _dt.fromisoformat(parsed_ts.replace("Z", "+00:00")).timestamp()
        except Exception:
            return None
        return None


    @staticmethod
    def _match_user_ip(msg: str, event_kind: str) -> Dict[str, Optional[str]]:
        """
        Extract username + source IP from syslog message body.

        Patterns handled (in priority order):
          - sshd: "Failed password for {user} from {ip} port ..."
          - sshd: "Accepted password for {user} from {ip} port ..."
          - sshd: "Invalid user {user} from {ip}"
          - sudo: " {user} : TTY=... ; USER=root ; COMMAND=..."
          - su:   "su[...]: pam_unix(su:session): session opened for user {user} by ..."
          - useradd: "new user: name={user}, UID=..."
          - polkit: "Authentication failed for user {user}"
        Returns dict with keys: user, ip, port (port extracted when present).
        """
        import re as _re
        m = _re.search(r'\b(?:Failed\s+password|Invalid\s+user|Accepted\s+(?:password|publickey)|Authentication\s+(?:failed|denied))\s+for(?:\s+user)?\s+([^\s]+)\s+from\s+(\S+)', msg, _re.IGNORECASE)
        if m:
            return {"user": m.group(1), "ip": m.group(2), "port": None}
        # sshd "Disconnecting ... [preauth]" or "Connection closed" — no user
        # sudo "user : TTY=..."
        m = _re.search(r'^([a-z_][a-z0-9_-]{0,31})\s*:\s*TTY=', msg, _re.IGNORECASE)
        if m:
            return {"user": m.group(1), "ip": None, "port": None}
        # useradd / usermod
        m = _re.search(r'\bnew user:\s*name=([^,\s]+)', msg, _re.IGNORECASE)
        if m:
            return {"user": m.group(1), "ip": None, "port": None}
        # generic
        m = _re.search(r'user[=:]\s*([a-z_][a-z0-9_-]{0,31})', msg, _re.IGNORECASE)
        if m:
            return {"user": m.group(1), "ip": None, "port": None}
        return {"user": None, "ip": None, "port": None}

    @staticmethod
    def _extract_service_unit(msg: str) -> Optional[str]:
        """
        Extract systemd unit name from syslog message.

        Patterns handled:
          - "monitoring-agent.service: Main process exited..."
          - "Started nginx.service."
          - "Stopped mysql.service."
          - "Failed with result 'exit-code'." (need surrounding context for unit)
        Returns unit name like "monitoring-agent.service" or None.
        """
        import re as _re
        # Unit name before ".service: ..." (most specific)
        m = _re.search(r'\b([a-z0-9][a-z0-9_.+-]*\.service)(?::\s|$)', msg, _re.IGNORECASE)
        if m:
            return m.group(1)
        # Unit name in "Started X.service." / "Stopped X.service." patterns
        m = _re.search(r'\b(?:Started|Stopped|Failed|Reloaded|Reached target)\s+([a-z0-9][a-z0-9_.+-]*\.[a-z]+)\b', msg, _re.IGNORECASE)
        if m:
            return m.group(1)
        return None

    def _make_event(self, severity, event_type, source_app, pid, message, raw):
        # 2026-06-22: fix hardcoded 'log.line' event_type bug — was always
        # overriding the caller-provided event_type (sshd, sudo, service.failed,
        # brute force, etc). Now respects the param. category is still
        # derived from event_type prefix for UI grouping.
        return {
            'event_type': event_type,
            'severity': severity,
            'source': self.source_path,
            'message': message,
            'raw_data': {
                **raw,
                'category': self.get_category(event_type),
                'eventKind': event_type,  # explicit alias for UI/API consumers
            },
        }



class AuditdParser:
    """
    Parse Linux auditd (audit.log) lines.

    Format (one line per event, space-separated key=value pairs):
        type=USER_LOGIN msg=audit(1700000000.123:456): pid=1 uid=0 auid=4294967295 ses=4294967295 msg='op=login id=4294967295 exe="/usr/sbin/sshd" hostname=? addr=1.2.3.4 terminal=pts/0 res=failed' UID="root" AUID="unset"
        type=SYSCALL msg=audit(1700000000.124:457): arch=c000003e syscall=59 success=yes exit=0 a0=... a1=... ppid=1 pid=12345 auid=0 uid=0 gid=0 euid=0 suid=0 fsuid=0 egid=0 sgid=0 fsgid=0 tty=(none) ses=4294967295 comm="sudo" exe="/usr/bin/sudo" subj=unconfined key="sudo_use" ARCH=x86_64 SYSCALL=execve AUID="root" UID="root" GID="root" EUID="root" SUID="root" FSUID="root" EGID="root" SGID="root" FSGID="root"
        type=USER_START msg=audit(1700000000.125:458): pid=12345 uid=0 auid=4294967295 ses=4294967295 msg='op=login id=0 exe="/usr/sbin/sshd" hostname=? addr=1.2.3.4 terminal=pts/0 res=success' UID="root" AUID="unset"

    Captures high-signal event types (others skipped to avoid BPF/CRED noise):
      - USER_LOGIN / USER_LOGOUT - user session lifecycle
      - USER_START / USER_END - user process context (su, sudo, ssh)
      - LOGIN / LOGOUT - tty logins (rare on Ubuntu)
      - SYSCALL - filtered to known interesting keys (sudo_use, sshd_config_changes, etc.)
      - CONFIG_CHANGE - audit rules changed
      - SERVICE_START / SERVICE_STOP - systemd unit changes

    Setup on target Linux host:
      apt install auditd                          # Debian/Ubuntu
      systemctl enable --now auditd
      cat >> /etc/audit/rules.d/openshield.rules << 'EOF'
      -w /etc/passwd -p wa -k passwd_changes
      -w /etc/shadow -p wa -k shadow_changes
      -w /etc/sudoers -p wa -k sudoers_changes
      -w /etc/ssh/sshd_config -p wa -k sshd_config_changes
      -a always,exit -F path=/usr/bin/sudo -F perm=x -k sudo_use
      -a always,exit -F path=/usr/bin/su -F perm=x -k su_use
      EOF
      auditctl -R /etc/audit/rules.d/openshield.rules

    Emits 'log.line' events with severity:
      - ERROR: failed USER_LOGIN / USER_AUTH
      - WARN:  CONFIG_CHANGE, failed SERVICE_*, failed syscall
      - INFO:  everything else
    """

    # High-signal event types we always capture
    INTERESTING_TYPES = {
        "USER_LOGIN", "USER_LOGOUT",
        "USER_START", "USER_END",
        "USER_AUTH", "USER_ACCT",
        "LOGIN", "LOGOUT",
        "CONFIG_CHANGE", "DAEMON_CONFIG",
        "SERVICE_START", "SERVICE_STOP",
        "SYSCALL",
    }

    # Map auditd event type to our canonical event_type
    EVENT_TYPE_MAP = {
        "USER_LOGIN":    "user.login",
        "USER_LOGOUT":   "user.logout",
        "USER_START":    "user.session_start",
        "USER_END":      "user.session_end",
        "USER_AUTH":     "user.auth",
        "USER_ACCT":     "user.acct",
        "LOGIN":         "user.tty_login",
        "LOGOUT":        "user.tty_logout",
        "CONFIG_CHANGE": "audit.config_change",
        "DAEMON_CONFIG": "audit.daemon_config",
        "SERVICE_START": "service.start",
        "SERVICE_STOP":  "service.stop",
        "SYSCALL":       "syscall.exec",
    }

    # Capture SYSCALL only if it has one of these keys
    SYSCALL_KEYS_OF_INTEREST = {
        "sudo_use", "su_use", "passwd_changes", "shadow_changes",
        "sudoers_changes", "sshd_config_changes", "time_change",
    }

    # Regex: parse "type=XXX msg=audit(TS:ID):"
    RE_TYPE = re.compile(r"^type=(\S+)")
    RE_MSG_TIMESTAMP = re.compile(r"msg=audit\((\d+\.\d+):(\d+)\)")
    # Match key=value (value can be quoted string or unquoted token).
    # Unquoted values cannot start with a quote (auditd concatenates res=success'AUID="...").
    RE_KV = re.compile(r'(\w+)=(?:"([^"]*)"|([^\s\'"]+))')

    def __init__(self):
        pass

    def parse(self, line: str) -> Optional[Dict[str, Any]]:
        line = line.rstrip("\n")
        if not line or not line.startswith("type="):
            return None

        # Extract type=
        m_type = self.RE_TYPE.match(line)
        if not m_type:
            return None
        auditd_type = m_type.group(1)

        # Filter: skip non-interesting types
        if auditd_type not in self.INTERESTING_TYPES:
            return None

        # Extract msg timestamp
        m_ts = self.RE_MSG_TIMESTAMP.search(line)
        if m_ts:
            try:
                unix_ts = float(m_ts.group(1))
                event_time = datetime.fromtimestamp(unix_ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{int((unix_ts % 1) * 1000):03d}Z"
            except (ValueError, OSError):
                event_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            event_id = int(m_ts.group(2))
        else:
            event_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            event_id = None

        # For SYSCALL: filter to interesting keys only
        if auditd_type == "SYSCALL":
            m_key = re.search(r'key="([^"]*)"', line)
            if not m_key or m_key.group(1) not in self.SYSCALL_KEYS_OF_INTEREST:
                return None

        # Parse all key=value pairs into dicts
        kv_unquoted = {}
        kv_quoted = {}
        for m in self.RE_KV.finditer(line):
            key = m.group(1)
            if m.group(2) is not None:
                kv_quoted[key] = m.group(2)
            else:
                kv_unquoted[key] = m.group(3)

        # Extract common fields
        pid = int(kv_unquoted["pid"]) if "pid" in kv_unquoted and kv_unquoted["pid"].isdigit() else None
        uid = kv_unquoted.get("uid")
        euid = kv_unquoted.get("euid")
        auid = kv_unquoted.get("auid")
        comm = kv_quoted.get("comm", "")
        exe = kv_quoted.get("exe", "")
        addr = kv_unquoted.get("addr")
        key = kv_quoted.get("key")
        syscall = kv_quoted.get("SYSCALL", "")
        res = kv_unquoted.get("res", "")

        # Severity mapping
        is_failed = res in ("failed", "0") or res.startswith("fail")
        if auditd_type == "USER_LOGIN" and is_failed:
            severity = "ERROR"
        elif auditd_type == "SYSCALL" and is_failed:
            severity = "ERROR"
        elif auditd_type in ("CONFIG_CHANGE", "DAEMON_CONFIG"):
            severity = "WARN"
        elif auditd_type in ("SERVICE_START", "SERVICE_STOP") and is_failed:
            severity = "WARN"
        else:
            severity = "INFO"

        # Map to canonical event type (detail also goes to rawData.event)
        event_type = "log.line"  # Zod schema restricts to fixed set; detail in rawData.event
        canonical_event = self.EVENT_TYPE_MAP.get(auditd_type, f"auditd.{auditd_type.lower()}")

        # Build message excerpt
        if auditd_type in ("USER_LOGIN", "USER_START"):
            user = kv_quoted.get("UID") or uid or "?"
            proto = "tty" if kv_unquoted.get("terminal", "none") != "none" else "remote"
            message = f"{auditd_type}: {user}@{addr or 'localhost'} via {proto} ({'FAILED' if is_failed else 'success'})"
        elif auditd_type == "SYSCALL":
            message = f"{comm or 'process'} (pid={pid}) ran {syscall or 'syscall'} [{key}] {'FAILED' if is_failed else 'ok'}"
        elif auditd_type == "CONFIG_CHANGE":
            message = f"audit config changed: {comm or 'auditctl'} pid={pid} op={kv_unquoted.get('op', '?')}"
        elif auditd_type in ("SERVICE_START", "SERVICE_STOP"):
            m_unit = re.search(r"unit=([\w\-\.]+)", line)
            unit = m_unit.group(1) if m_unit else "?"
            message = f"{auditd_type}: {unit} ({'FAILED' if is_failed else 'ok'})"
        else:
            message = f"{auditd_type}: {comm or exe or '?'} (pid={pid}) res={res}"

        # Truncate for dashboard
        msg_excerpt = message[:240] + ("..." if len(message) > 240 else "")

        return {
            "event_type": event_type,
            "severity": severity,
            "source": "/var/log/audit/audit.log",
            "message": msg_excerpt,
            "raw_data": {
                "event": canonical_event,
                "auditd_type": auditd_type,
                "event_id": event_id,
                "pid": pid,
                "uid": uid,
                "euid": euid,
                "auid": auid,
                "comm": comm,
                "exe": exe,
                "addr": addr,
                "key": key,
                "syscall": syscall,
                "res": res,
                "eventTime": event_time,
                "service": "AUDITD",
                "parser": "auditd",
                "raw_excerpt": line[:500],
            },
        }


PARSERS: Dict[str, Any] = {
    "sshd": SshdParser,
    "syslog": SyslogParser,
    "mysql_audit": MysqlAuditParser,
    "pgaudit": PgAuditParser,
    "auditd": AuditdParser,
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
        # Detect SSH server port ONCE at agent startup (used by SshdParser
        # for events where the log line doesn't carry the server-side port).
        # Detection only matters if any watcher uses the sshd parser.
        self.sshd_port = SshdParser.detect_sshd_port(log)
        self.log.info(f"OpenShield: SSH daemon listen port detected as {self.sshd_port}")
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
            if parser_name == "sshd":
                self.targets.append((path, PARSERS[parser_name](sshd_port=self.sshd_port)))
            else:
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
                self.log.info(f"Skip {path} (does not exist)")
                continue
            try:
                st = os.stat(path)
            except OSError as e:
                self.log.warning(f"Skip {path} (stat failed: {e})")
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
                    # 2026-06-22: parser.parse may return a LIST of events
                    # (e.g. SyslogParser emits an extra syslog.bruteforce
                    # alert when SSH failure threshold is reached).
                    ev_or_list = parser.parse(line)
                except Exception as e:
                    self.log.debug(f"{path}: parser exception: {e}")
                    ev_or_list = None
                if not ev_or_list:
                    continue
                # Normalize to list (legacy parsers still return a single dict).
                ev_list = ev_or_list if isinstance(ev_or_list, list) else [ev_or_list]
                for ev in ev_list:
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
        self._flush_failed_this_tick = False
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
        if len(self.event_buffer) > 5000:
            self.event_buffer = self.event_buffer[-5000:]
        if len(self.event_buffer) >= self.event_batch_size and not self._flush_failed_this_tick:
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

        if not self.event_buffer:
            body_obj = {
                "version": VERSION,
                "events": [],
                "stats": get_system_stats(),
                "identity": self._identity or {},
            }
            body = json.dumps(body_obj)
            sig = sign_body(self.secret_token, body)
            headers = {
                "X-Openshield-Agent-Id": self.agent_id,
                "X-Openshield-Agent-Signature": sig,
            }
            ok, data = self._request("POST", "/api/agents/heartbeat", body, headers)
            if not ok:
                self._flush_failed_this_tick = True
                return False
            return True

        batch_size = min(self.event_batch_size, 500)
        if batch_size < 1:
            batch_size = 100

        while self.event_buffer:
            chunk = self.event_buffer[:batch_size]
            server_events = []
            for ev in chunk:
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
                "identity": self._identity or {},
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
                self.log.info(
                    f"Heartbeat OK (events={len(chunk)} "
                    f"inserted={stats.get('eventsInserted', 0)} "
                    f"deduped={stats.get('eventsDeduped', 0)})"
                )
                self.event_buffer = self.event_buffer[len(chunk):]
            else:
                self._flush_failed_this_tick = True
                return False
        return True

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
                self._flush_failed_this_tick = False
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
                if not self._flush_failed_this_tick:
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
