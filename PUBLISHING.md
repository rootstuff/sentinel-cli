# Publishing @rootstuff/sentinel

Internal notes for cutting a release. The package lives in `packages/cli` of the Sentinel repo and publishes as the scoped, public package `@rootstuff/sentinel` (bin: `sentinel`).

## Before publishing

```bash
cd packages/cli

# Tests must pass (node:test, stub HTTP server, no extra deps)
npm test

# Smoke the real binary against a live instance
SENTINEL_TOKEN=... node bin/sentinel.js auth whoami
SENTINEL_TOKEN=... node bin/sentinel.js check https://example.com

# Bump the version (creates a git tag if the working tree is clean)
npm version patch     # or minor / major
```

Check that README.md reflects any new commands or flags. The site docs page (`resources/js/Pages/Public/Docs/cli.js`) should match too.

## Publish

```bash
# One-time: log in to npm as a member of the rootstuff org
npm login

# See exactly what goes in the tarball: bin/, src/, README.md, LICENSE, package.json
npm pack --dry-run

# Scoped packages default to private, so --access public is required
npm publish --access public
```

`publishConfig.access` is already `public` in package.json, so the flag is a belt-and-braces measure.

## Verify

```bash
npm info @rootstuff/sentinel
npx --yes @rootstuff/sentinel@latest --version
```

## Pre-release channel

```bash
npm version prerelease --preid beta     # 1.1.0-beta.0
npm publish --access public --tag beta
npx @rootstuff/sentinel@beta --version
```

## If a release is bad

Prefer deprecation over unpublishing (unpublish only works within 72 hours and breaks anyone who already installed it):

```bash
npm deprecate @rootstuff/sentinel@1.0.1 "Broken release, upgrade to 1.0.2"
```

## Versioning

Semver. Additive commands and flags are minor releases; changed flag semantics or removed commands are major.
