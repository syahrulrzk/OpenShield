# Agent Sync Rules

> **TL;DR:** If you change `agent.py`, you MUST also update `agents/python/agent.py` + bump `VERSION` + bump `AGENT_COMPAT.latest`. The pre-commit hook enforces this.

## Why

The OpenShield installer (`/api/install/python?agent_id=…&token=…`) downloads `agent.py` from `<repo>/agents/python/agent.py` — NOT from `/opt/openshield-agent/agent.py`. These are two separate copies:

| Path | Purpose | Audience |
|------|---------|----------|
| `/opt/openshield-agent/agent.py` | Live running copy | dev/ops hot-patch on host |
| `agents/python/agent.py` | Source-of-truth for installers | new agent installs, agent updates via dashboard |

When you patch the live copy on a host, the repo source MUST be kept in lockstep — otherwise:

- New agent installs get the **old** code (silently buggy)
- Update Agent button on dashboard downloads the **old** code
- You think you fixed a bug; users still see the old behavior

## Rule of Thumb

Every change to `agent.py` follows this 4-step ritual:

```bash
# 1. Edit /opt/openshield-agent/agent.py (or wherever the live copy lives)

# 2. Sync to repo
npm run sync-agent
# ↑ sudo cp /opt/openshield-agent/agent.py agents/python/agent.py

# 3. Bump version in BOTH places
#    - agents/python/agent.py:    VERSION = "1.1.0"  (was 1.0.0)
#    - src/lib/agent-versions.ts: AGENT_COMPAT.latest = "1.1.0"

# 4. Verify
npm run check-agent
```

If you skip step 3, the pre-commit hook blocks your commit with:

```
❌ VERSION MISMATCH: agent.py reports 1.0.0 but installer advertises 1.1.0
```

## When to bump

| Change kind | Bump? | Example |
|-------------|-------|---------|
| Add new parser pattern | Yes (minor) | sshd.shell_session → 1.1.0 |
| Add new event type | Yes (minor) | process.exec → 1.2.0 |
| Fix bug | Yes (patch) | dedup race fix → 1.1.1 |
| Breaking config change | Yes (major + bump min) | drop YAML support → 2.0.0, min→2.0.0 |
| Refactor / comments only | No | — |

## How the guard works

`scripts/check-agent-sync.sh` runs three checks on every `git commit`:

1. **Live == source-of-truth** — `diff -q /opt/openshield-agent/agent.py agents/python/agent.py`
2. **Version pin consistent** — `VERSION = "X"` in agent.py == `latest: "X"` in agent-versions.ts
3. **Installer endpoint fresh** — `GET /api/install/raw/agent.py` returns matching version

Fails → commit blocked. To skip (DANGEROUS, only for trivial docs):

```bash
git commit --no-verify
```

## Useful commands

```bash
npm run check-agent           # Run sync guard (read-only)
npm run sync-agent            # Copy live agent → repo source
git commit                    # Auto-runs pre-commit hook
git commit --no-verify        # Skip pre-commit hook (avoid)
```

## Common scenarios

### Scenario A: Bug fix on production agent

You SSH'd into OP-01, fixed a regex in `/opt/openshield-agent/agent.py`, restarted the service, verified it works.

```bash
# On local dev box (same repo):
npm run sync-agent       # Pull latest from OP-01 to repo
# Edit VERSION 1.1.0 → 1.1.1 in agents/python/agent.py
# Edit AGENT_COMPAT.latest 1.1.0 → 1.1.1 in src/lib/agent-versions.ts
npm run check-agent      # Verify
git add -A && git commit  # Auto-runs guard
git push
# Now run Update Agent on OP-02 / OP-03 from dashboard
```

### Scenario B: New parser pattern (no live patch yet)

You wrote a new `apache_log` parser locally in agent.py.

```bash
# Edit /opt/openshield-agent/agent.py (add ApacheLogParser class)
# Edit agents/python/agent.py (same change, manual or via npm run sync-agent)
# Edit VERSION 1.1.0 → 1.2.0
# Edit AGENT_COMPAT.latest 1.1.0 → 1.2.0
npm run check-agent
git add -A && git commit
git push
# New agents get v1.2.0 with apache parser via installer
```

### Scenario C: Quick docs tweak

You only edited a markdown file. No agent change.

```bash
git commit --no-verify    # Skip guard (docs only)
```

## Cross-host deployment

For multi-host setups (dev_linux, cona, loadbalancer), after commit + push:

```bash
# From jump host, push to all outdated agents:
for host in 172.16.19.235 172.16.19.217 172.16.10.47; do
  ssh linux@$host 'curl -sL http://172.16.19.235:3001/api/install/raw/agent.py \
    | sudo tee /opt/openshield-agent/agent.py > /dev/null \
    && sudo systemctl restart openshield-agent'
done
```

Dashboard will show all agents at v1.2.0 within 30s of next heartbeat.

## See also

- `scripts/check-agent-sync.sh` — the guard implementation
- `.husky/pre-commit` — git hook wrapper
- `src/lib/agent-versions.ts` — version compat source
