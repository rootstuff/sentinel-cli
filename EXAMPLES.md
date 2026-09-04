# Examples

## Authentication

```bash
sentinel auth login --token YOUR_API_TOKEN
sentinel auth whoami
sentinel auth status
sentinel auth logout

# Environment variable instead of the config file
export SENTINEL_TOKEN="YOUR_API_TOKEN"
sentinel monitors list
```

---

## Global checks

```bash
# Every region
sentinel check https://example.com

# Two regions, shorter timeout
sentinel check https://example.com --regions ash,nbg --timeout 10

# Tolerate one region being down
sentinel check https://example.com --allow-partial

# Machine-readable
sentinel check https://example.com --format json | jq '.results[] | {region, status, response_time_ms}'
```

---

## Monitors

### Listing

```bash
sentinel monitors list
sentinel monitors list --status offline
sentinel monitors list --type ping
sentinel monitors list --search example.com
sentinel monitors list --interval 0.5
sentinel monitors list --sort last_checked_at --direction desc
sentinel monitors list --page 2 --per-page 50
sentinel monitors list --format json
```

### Creating

```bash
# Plain HTTP monitor, every minute, all regions
sentinel monitors create --url https://example.com --interval 1

# HTTP with SSL and DNS sub-checks from two regions
sentinel monitors create --url https://example.com --interval 5 \
  --check-types ssl,dns --regions ash,nbg --ssl-threshold 30

# POST with headers and a body, accept 2xx only
sentinel monitors create --url https://api.example.com/ping --method POST \
  --headers '{"Authorization":"Bearer abc","Content-Type":"application/json"}' \
  --body '{"ping":true}' --accepted-status-codes 2xx

# Keyword check
sentinel monitors create --url https://example.com \
  --keyword-settings '{"keywords":[{"phrase":"Welcome","mode":"must_contain"},{"phrase":"Fatal error","mode":"must_not_contain"}]}'

# JSON assertion
sentinel monitors create --url https://api.example.com/health \
  --json-assertion-settings '{"assertions":[{"path":"status","operator":"equals","value":"ok"},{"path":"queue.depth","operator":"lt","value":100}]}'

# Agent payment (x402 / MPP) check: healthy means a 402 with the expected envelope
sentinel monitors create --url https://api.example.com/paid --check-types payment \
  --payment-settings '{"expected":{"amount":"0.02","pay_to":"0xYourAddress","network":"eip155:8453"}}'

# Heartbeat (expects a ping every 24h, 10 min grace)
sentinel monitors create --type heartbeat --name "Nightly backup" \
  --heartbeat-interval 86400 --heartbeat-grace 600

# Cron schedule
sentinel monitors create --type cron --name "Reports" \
  --cron-expression "0 6 * * *" --heartbeat-timezone America/New_York

# Ping and port
sentinel monitors create --type ping --url example.com
sentinel monitors create --type port --url db.example.com --port 5432

# Into a group
sentinel monitors create --url https://example.com --group-id 3
```

### Updating

```bash
sentinel monitors update 123 --interval 0.5
sentinel monitors update 123 --url https://new.example.com
sentinel monitors update 123 --regions ash,pdx,nbg,sin
sentinel monitors update 123 --group-id none
sentinel monitors update 123 --no-follow-redirects --timeout 10
sentinel monitors update 123 --check-types ssl,payment \
  --payment-settings '{"expected":{"amount":"0.02","pay_to":"0xYourAddress","network":"eip155:8453"}}'
```

### Everything else

```bash
sentinel monitors get 123
sentinel monitors get 123 --format json
sentinel monitors check 123
sentinel monitors pause 123
sentinel monitors unpause 123
sentinel monitors delete 123 --yes
```

---

## Groups

```bash
sentinel groups list
sentinel groups get 3
sentinel groups create --name "Production" --description "Customer-facing services"
sentinel groups create --name "EU" --parent-id 3
sentinel groups update 3 --name "Prod"
sentinel groups update 4 --parent-id none
sentinel groups delete 4 --yes
```

---

## Incidents

```bash
sentinel incidents list
sentinel incidents list --status open
sentinel incidents list --monitor-id 123
sentinel incidents list --start-date 2026-01-01 --end-date 2026-12-31
sentinel incidents list --sort duration --direction desc

sentinel incidents get 456
sentinel incidents acknowledge 456      # alias: ack
sentinel incidents resolve 456
sentinel incidents delete 456 --yes
```

---

## Team members

```bash
sentinel users list
sentinel users list --format json | jq '.data[] | select(.mfa_enabled == false) | .email'

sentinel users invite grace@example.com --role editor
sentinel users set-role 11 admin
sentinel users remove 11 --yes

sentinel users invitations list
sentinel users invitations set-role 3 viewer
sentinel users invitations cancel 3 --yes
```

---

## Teams

```bash
sentinel teams list
sentinel teams switch 2
```

---

## Webhooks

```bash
sentinel webhooks list
sentinel webhooks get 4

# Bearer auth, critical + warning only
sentinel webhooks create --name "PagerDuty" --url https://events.example.com/in \
  --auth-type bearer --auth-token TOKEN --severities critical,warning

# Custom header auth with HMAC signing
sentinel webhooks create --name "Internal" --url https://ops.example.com/hooks \
  --auth-type header --auth-header-name X-Api-Key --auth-token KEY \
  --signing-secret "a-secret-of-at-least-16-chars"

sentinel webhooks update 4 --no-active
sentinel webhooks update 4 --auth-token ROTATED       # other secrets stay as stored
sentinel webhooks test 4
sentinel webhooks delete 4 --yes
```

---

## Status pages

```bash
sentinel status-pages list
sentinel status-pages get 1

sentinel status-pages create --name "Acme Status" --slug acme \
  --monitors 12:API,34:Website --description "Live service status"

sentinel status-pages update 1 --name "Acme"
sentinel status-pages update 1 --monitors 12:API,34:Website,56:Docs
sentinel status-pages update 1 --settings '{"show_response_time":false}'
sentinel status-pages delete 1 --yes
```

---

## Notifications

```bash
sentinel notifications list
sentinel notifications get slack

sentinel notifications create --type slack --webhook-url https://hooks.slack.com/services/XXX/YYY/ZZZ
sentinel notifications create --type sms --phone +15555550100

sentinel notifications update slack --webhook-url NEW_URL
sentinel notifications enable email
sentinel notifications disable sms
sentinel notifications test slack
sentinel notifications delete slack --yes
```

---

## Scripting

```bash
# Export
sentinel monitors list --per-page 100 --format json > monitors.json
sentinel incidents list --status open --format json > incidents.json

# Alert when anything is down
DOWN=$(sentinel monitors list --status offline --format json | jq '.data | length')
if [ "$DOWN" -gt 0 ]; then
  echo "ALERT: $DOWN monitors are down"
  sentinel monitors list --status offline
  exit 1
fi

# Pause every monitor in a group
sentinel monitors list --per-page 100 --format json | \
  jq -r '.data[] | select(.group_id == 3) | .id' | \
  xargs -I {} sentinel monitors pause {}

# Resume them
sentinel monitors list --per-page 100 --format json | \
  jq -r '.data[] | select(.group_id == 3) | .id' | \
  xargs -I {} sentinel monitors unpause {}
```

---

## CI/CD

### GitHub Actions

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    env:
      SENTINEL_TOKEN: ${{ secrets.SENTINEL_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - run: npm install -g @rootstuff/sentinel

      - name: Pause monitoring
        run: sentinel monitors pause ${{ vars.MONITOR_ID }}

      - name: Deploy
        run: ./deploy.sh

      - name: Resume monitoring
        run: sentinel monitors unpause ${{ vars.MONITOR_ID }}

      # Fails the job unless every region reaches the site
      - name: Verify from every region
        run: sentinel check https://example.com
```

### GitLab CI

```yaml
deploy:
  variables:
    SENTINEL_TOKEN: $SENTINEL_TOKEN
  script:
    - npm install -g @rootstuff/sentinel
    - sentinel monitors pause $MONITOR_ID
    - ./deploy.sh
    - sentinel monitors unpause $MONITOR_ID
    - sentinel check https://example.com
```

---

## Local development

```bash
export SENTINEL_API_URL=https://sentinel.rootstuff.test
sentinel auth login --token YOUR_TOKEN

# Or per command
sentinel monitors list --api-url https://sentinel.rootstuff.test
```
