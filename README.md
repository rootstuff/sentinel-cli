# Sentinel CLI

[![npm version](https://img.shields.io/npm/v/%40rootstuff%2Fsentinel)](https://www.npmjs.com/package/@rootstuff/sentinel)

Command-line interface for [Sentinel](https://sentinel.rootstuff.io), the uptime monitoring service. Manage monitors, groups, incidents, team members, webhooks, status pages, and notification channels from a terminal or a CI job, and probe any URL from every monitoring region on demand.

Full docs: https://sentinel.rootstuff.io/docs/cli
On npm: https://www.npmjs.com/package/@rootstuff/sentinel

## Installation

```bash
npm install -g @rootstuff/sentinel
```

Requires Node.js 18 or newer. The package installs a `sentinel` command.

## Quick start

```bash
# Save your API token (create one under Account > API tokens in the dashboard)
sentinel auth login --token YOUR_API_TOKEN

# Confirm who you are and which team the token acts on
sentinel auth whoami

# List your monitors
sentinel monitors list

# Probe a URL from every region, exit non-zero if any region can't reach it
sentinel check https://example.com
```

## Authentication

The CLI looks for a token in this order:

1. `--token YOUR_TOKEN` on the command
2. The `SENTINEL_TOKEN` environment variable
3. The config file written by `sentinel auth login`

API tokens carry permissions (read, create, update, delete). A read-only token can list and inspect; anything that changes data needs the matching permission on the token. The free plan has read-only API access; paid plans get full access.

```bash
sentinel auth login --token YOUR_API_TOKEN   # Save token to config
sentinel auth logout                          # Remove saved token
sentinel auth whoami                          # Verify the token and show user + team
sentinel auth status                          # Show config without a network call
```

Every command acts on the token's current team. `sentinel teams list` shows which one that is, and `sentinel teams switch <id>` changes it.

## Commands

### check

On-demand global check. Probes a URL from every monitoring region right now without creating a monitor. Exits 0 when every region reached the URL and 1 otherwise, so it works as a deploy gate.

```bash
sentinel check https://example.com
sentinel check https://example.com --regions ash,nbg --timeout 10
sentinel check https://example.com --allow-partial      # exit 0 if at least one region reached it
sentinel check https://example.com --format json
```

On-demand checks are included in every paid plan. On the free plan the command prints the plan message and exits 1.

### monitors

```bash
sentinel monitors list
sentinel monitors list --status offline --format json
sentinel monitors list --type heartbeat --search backup --page 2

sentinel monitors get <id>
sentinel monitors create --url https://example.com --interval 1
sentinel monitors update <id> --interval 0.5
sentinel monitors delete <id> --yes

sentinel monitors check <id>        # Immediate check from the API server
sentinel monitors pause <id>
sentinel monitors unpause <id>
```

`--interval` is in minutes. `0.5` means every 30 seconds; the floor depends on your plan.

Create and update accept the whole monitor field set:

| Flag | API field | Notes |
| --- | --- | --- |
| `--type` | `monitor_type` | http, ping, port, heartbeat, cron (create only) |
| `--url` | `url` | Full URL for http; bare host for ping/port |
| `--name` | `friendly_name` | Required for heartbeat and cron monitors |
| `--interval` | `check_interval` | Minutes, 0.5 to 60 |
| `--check-types` | `check_types` | Comma list: ssl,dns,domain,keyword,json,lighthouse,payment |
| `--regions` | `monitored_regions` | Comma list: ash,pdx,nbg,sin |
| `--group-id` | `group_id` | Group ID, or `none` to ungroup |
| `--method` | `http_method` | GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS |
| `--accepted-status-codes` | `accepted_status_codes` | Comma list, e.g. `200,201,3xx` |
| `--follow-redirects` / `--no-follow-redirects` | `follow_redirects` | |
| `--timeout` | `request_timeout` | Seconds, 1 to 60 |
| `--headers` | `request_headers` | JSON object |
| `--body` | `request_body` | String |
| `--ssl-threshold` | `ssl_expiry_threshold` | Days |
| `--domain-threshold` | `domain_expiry_threshold` | Days |
| `--slow-response-threshold` | `slow_response_threshold` | Milliseconds |
| `--keyword-settings` | `keyword_settings` | JSON |
| `--json-assertion-settings` | `json_assertion_settings` | JSON |
| `--payment-settings` | `payment_settings` | JSON |
| `--lighthouse-settings` | `lighthouse_settings` | JSON |
| `--port` | `port` | Port monitors |
| `--heartbeat-interval` | `heartbeat_interval` | Seconds, heartbeat monitors |
| `--cron-expression` | `heartbeat_cron_expression` | Cron monitors |
| `--heartbeat-timezone` | `heartbeat_timezone` | |
| `--heartbeat-grace` | `heartbeat_grace` | Seconds |

Examples:

```bash
# Keyword check
sentinel monitors create --url https://example.com --check-types keyword \
  --keyword-settings '{"keywords":[{"phrase":"Welcome","mode":"must_contain"}]}'

# JSON assertion against an API
sentinel monitors create --url https://api.example.com/health --check-types json \
  --json-assertion-settings '{"assertions":[{"path":"status","operator":"equals","value":"ok"}]}'

# Agent payment check: expect an HTTP 402 with a specific x402/MPP envelope
sentinel monitors update 42 --check-types payment \
  --payment-settings '{"expected":{"amount":"0.02","pay_to":"0xYourAddress","network":"eip155:8453"}}'

# Heartbeat monitor for a nightly job
sentinel monitors create --type heartbeat --name "Nightly backup" --heartbeat-interval 86400 --heartbeat-grace 600

# Cron monitor
sentinel monitors create --type cron --name "Reports" --cron-expression "0 6 * * *" --heartbeat-timezone UTC

# Port monitor
sentinel monitors create --type port --url db.example.com --port 5432
```

`monitors update` only changes the flags you pass. It reads the monitor first so required fields (URL, active sub-check settings, push schedule) travel with the request. One thing to know: the API's full update does not carry the monitor's tags, so an update from the CLI leaves the monitor's tags empty. Re-apply tags in the dashboard if you use them.

### groups

Monitor groups nest one level deep. Monitors join a group with `monitors create --group-id <id>` or `monitors update <id> --group-id <id>`.

```bash
sentinel groups list
sentinel groups get <id>
sentinel groups create --name "Production" --description "Customer-facing"
sentinel groups create --name "EU" --parent-id 3
sentinel groups update <id> --name "Prod" --parent-id none
sentinel groups delete <id> --yes      # monitors are ungrouped, subgroups move to the top level
```

### incidents

```bash
sentinel incidents list
sentinel incidents list --status open --monitor-id 42
sentinel incidents list --start-date 2026-01-01 --end-date 2026-01-31 --format json

sentinel incidents get <id>
sentinel incidents acknowledge <id>
sentinel incidents resolve <id>
sentinel incidents delete <id> --yes
```

### users

Team members and pending invitations. Roles are `admin`, `editor`, and `viewer`; the owner cannot be re-roled or removed.

```bash
sentinel users list                                   # role, MFA state, last sign-in
sentinel users invite someone@example.com --role editor
sentinel users set-role <member-id> admin
sentinel users remove <member-id> --yes

sentinel users invitations list
sentinel users invitations set-role <invitation-id> viewer
sentinel users invitations cancel <invitation-id> --yes
```

### teams

```bash
sentinel teams list
sentinel teams switch <id>
```

### webhooks

Outbound webhook endpoints that receive alert payloads. The URL, auth token, and signing secret are write-only: the API accepts them but never returns them, and omitting them on update keeps the stored values.

```bash
sentinel webhooks list
sentinel webhooks get <id>
sentinel webhooks create --name "PagerDuty" --url https://events.example.com/in \
  --auth-type bearer --auth-token TOKEN --severities critical,warning
sentinel webhooks update <id> --no-active
sentinel webhooks update <id> --auth-token ROTATED
sentinel webhooks test <id>
sentinel webhooks delete <id> --yes
```

Auth types: `none`, `bearer`, `header` (with `--auth-header-name`), `basic`. Severities: `critical`, `warning`, `info`.

### status-pages

A status page lists one or more monitors as services. Pass them as `id` or `id:Label` pairs.

```bash
sentinel status-pages list
sentinel status-pages get <id>
sentinel status-pages create --name "Acme Status" --slug acme --monitors 12:API,34:Website
sentinel status-pages update <id> --name "Acme" --monitors 12:API
sentinel status-pages delete <id> --yes
```

### notifications

Personal notification channels (Slack webhook, SMS, email).

```bash
sentinel notifications list
sentinel notifications get slack
sentinel notifications create --type slack --webhook-url https://hooks.slack.com/services/...
sentinel notifications create --type sms --phone +15555550100
sentinel notifications enable email
sentinel notifications disable sms
sentinel notifications test slack
sentinel notifications delete slack --yes
```

## Global options

Every command accepts:

- `--token <token>`: API token (overrides the environment and config)
- `--api-url <url>`: API base URL (self-hosted or local instances)
- `--format table|json`: output format on commands that print data
- `--yes`: skip the confirmation prompt on delete and remove commands

## Environment variables

- `SENTINEL_TOKEN`: API token
- `SENTINEL_API_URL`: API base URL (default `https://sentinel.rootstuff.io`)
- `SENTINEL_CONFIG_DIR`: directory for the config file (handy on CI runners)

## CI usage

```yaml
# GitHub Actions
- name: Verify the site is reachable from every region
  env:
    SENTINEL_TOKEN: ${{ secrets.SENTINEL_TOKEN }}
  run: npx --yes @rootstuff/sentinel check https://example.com
```

```bash
# Pause a monitor around a deploy
sentinel monitors pause 42
./deploy.sh
sentinel monitors unpause 42

# Fail a job when anything is down
DOWN=$(sentinel monitors list --status offline --format json | jq '.data | length')
[ "$DOWN" -eq 0 ] || { echo "$DOWN monitors are down"; exit 1; }
```

## Local development

```bash
export SENTINEL_API_URL=https://sentinel.rootstuff.test
sentinel auth login --token YOUR_TOKEN
```

Self-signed certificates on `localhost` and `.test` hosts are accepted automatically.

## Configuration

`sentinel auth status` prints where the config file lives on your system.

## License

MIT
