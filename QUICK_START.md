# Quick Start

## Install

```bash
npm install -g @rootstuff/sentinel
```

## Authenticate

Create an API token in the [Sentinel dashboard](https://sentinel.rootstuff.io) (Account > API tokens), then:

```bash
sentinel auth login --token YOUR_API_TOKEN
sentinel auth whoami
```

## Check a URL from every region

```bash
sentinel check https://example.com
```

Exit code 0 means every region reached it. Anything else exits 1, which makes it a one-line deploy gate.

## Monitors

```bash
sentinel monitors list
sentinel monitors create --url https://example.com --interval 1
sentinel monitors update <id> --check-types ssl,keyword \
  --keyword-settings '{"keywords":[{"phrase":"Welcome","mode":"must_contain"}]}'
sentinel monitors pause <id>
sentinel monitors unpause <id>
sentinel monitors delete <id> --yes
```

`--interval` is in minutes (`0.5` = 30 seconds).

## Groups

```bash
sentinel groups create --name "Production"
sentinel monitors update <id> --group-id <group-id>
```

## Incidents

```bash
sentinel incidents list --status open
sentinel incidents acknowledge <id>
sentinel incidents resolve <id>
```

## Team

```bash
sentinel users list
sentinel users invite someone@example.com --role editor
sentinel teams list
sentinel teams switch <id>
```

## Webhooks and status pages

```bash
sentinel webhooks create --name "Ops" --url https://hooks.example.com/in --auth-type bearer --auth-token TOKEN
sentinel status-pages create --name "Status" --slug status --monitors 1:API,2:Website
```

## JSON output

Add `--format json` to any command that prints data:

```bash
sentinel monitors list --format json | jq '.data[].url'
```

## Help

```bash
sentinel --help
sentinel monitors --help
sentinel monitors create --help
```

## Local instance

```bash
export SENTINEL_API_URL=https://sentinel.rootstuff.test
sentinel auth login --token YOUR_TOKEN
```
