# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| latest (`main`) | ✅ |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report them privately via GitHub's built-in security advisory system:

1. Go to the **Security** tab of this repository
2. Click **"Report a vulnerability"**
3. Fill in the details

Alternatively, you can email the maintainer directly (address on the GitHub profile).

We aim to acknowledge reports within **48 hours** and provide a fix or mitigation within **7 days** for critical issues.

## Scope

LanClip is designed for **trusted LAN environments**. It has no authentication layer by default. If you expose it to the internet, please put it behind a reverse proxy with authentication (e.g. Caddy basic auth, Nginx, Tailscale).

Known intentional limitations:

- No authentication — by design for LAN use
- Clips are stored as plain text files — no encryption at rest
- The search endpoint runs `grep` on user-supplied queries — input is sanitized but treat it as a LAN-only service

## Security features

- **Helmet.js** — HTTP security headers (CSP, X-Frame-Options, X-Content-Type-Options, etc.)
- **Rate limiting** — 300 req / 15 min (general), 60 clips / 15 min (writes) per IP
- **Input validation** — clip IDs validated with strict regex to prevent path traversal
- **Non-root Docker user** — container runs as unprivileged `lanclip` user
- **Multi-stage Docker build** — production image contains only runtime dependencies
