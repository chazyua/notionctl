# Changelog

All notable changes to `notionctl` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — TBD

### Added
- Initial implementation of 28 Notion CLI commands (`page`, `db`, `block`, `comment`, `user`, `auth`, and meta commands)
- Zero-runtime-dependency TypeScript codebase using Node 18+ built-ins
- Markdown ↔ Notion blocks round-trip converter with metadata sidecars
- Property value DSL covering all writable Notion property types
- Content-hashed `page sync` command for idempotent file-backed pages
- Raw REST escape hatch (`notionctl api <METHOD> <path>`)
- Structured error model with typed error codes and distinct exit codes
- `--dry-run` support on all write operations

## [0.0.1] — 2026-04-09

### Added
- Initial placeholder package to reserve the `notionctl` name on npm registry
