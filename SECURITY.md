# Security Policy

## Reporting a Vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

Report security issues privately via GitHub Security Advisory:
https://github.com/chazyua/notionctl/security/advisories/new

We will acknowledge receipt within 72 hours and work with you to verify,
reproduce, and address the issue before any public disclosure.

## Security Posture

`notionctl` is designed with security as a primary concern:

- **Zero runtime dependencies.** Every line of network and secret-handling
  code is auditable in this repository.
- **Single file for network I/O** (`src/http.ts`). All outbound traffic
  goes through this file; it is hardcoded to `https://api.notion.com/v1`
  and refuses any other host.
- **Single file for secrets** (`src/auth.ts`). Tokens are loaded from
  `NOTION_TOKEN` environment variable or from a mode-0600 config file.
  They are never logged, never included in error messages, never in
  debug output.
- **No telemetry, no phone-home, no crash reporting.** The CLI's only
  outbound traffic is to `api.notion.com`. This is provable by grep.
- **Dry-run universal.** All write operations support `--dry-run` to
  preview what would be sent without sending it.
- **Reproducible releases.** Each published version's source SHA-256 is
  documented in `CHANGELOG.md` and matches the GitHub release tag.

## Scope

In-scope vulnerabilities include:
- Token leakage in logs, errors, or stdout/stderr
- Unauthorized filesystem writes
- Unauthorized network calls (anywhere other than `api.notion.com`)
- Command injection, path traversal, SSRF
- Dependency supply-chain issues (there are no runtime dependencies)

Out-of-scope:
- Issues in Notion's API itself (report to Notion)
- Issues in Node.js or npm (report upstream)
