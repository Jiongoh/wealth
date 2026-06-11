## CodeGraph usage

When analyzing this repository, prefer CodeGraph before broad file exploration.

Use CodeGraph for:
- finding symbols, API routes, components, and data flow
- understanding callers/callees
- impact analysis before edits
- locating affected tests or related files

Avoid repeated grep/read/ls loops when CodeGraph can answer the structural question.
Use normal file reads only after CodeGraph identifies the relevant files/symbols.

Cloudflare Access

https://your-domain.example.com is protected by Cloudflare Access.

If Codex needs to access the service through the public domain, it must load:

/root/wealth/.env.codex-access

and send these headers with every request:

CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}
CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}

Example:

set -a; source /root/wealth/.env.codex-access; set +a; curl -fsS -H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}" -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}" https://your-domain.example.com/api/health

Do not print, commit, hard-code, or expose the access token values.

For local host checks, prefer local origin URLs instead of the public domain.
