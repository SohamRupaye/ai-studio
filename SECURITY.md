# Security Policy

## Supported Versions

Security fixes are applied to the latest commit on the `main` branch and published via tagged GitHub Releases (`v*.*.*`).

| Branch / Release | Supported |
| --- | --- |
| `main` (latest) | Yes |
| `dev` (active development) | Best-effort |
| Older commits / tags | No |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report vulnerabilities privately via [GitHub Security Advisories](https://github.com/SohamRupaye/ai-studio/security/advisories/new). Include:

- A clear description of the vulnerability and affected file(s) or package(s)
- Minimal reproduction steps or proof-of-concept
- Potential impact and any suggested remediation

You can expect an initial acknowledgment within 72 hours and a coordinated fix/disclosure plan once confirmed.

## Security Architecture & Automated Controls

- **Desktop process isolation**: Electron renderer runs with context isolation behind a typed preload bridge (`@squirl/event-bus`) and a strict Content Security Policy.
- **Credential handling**: API keys and OAuth tokens are stored locally with restrictive file permissions (`0700` directory / `0600` files) and never serialized to renderer state.
- **Input & tool hardening**: Shell commands use argument-array `execFile`/`execFileSync` (no shell interpolation), markdown links allowlist `http:`/`https:`/`mailto:`, skill downloads enforce size caps and `path.resolve` containment, and file operations use handle/descriptor-based reads to prevent TOCTOU races.
- **Automated DevSecOps gates**: Every PR and weekly scheduled run executes **CodeQL (`security-extended`)** for SAST and **Trivy (`vuln,secret`, `HIGH,CRITICAL`)** for dependency & secret scanning, with SARIF reports uploaded to GitHub Security.
