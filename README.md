# MSSP Elastic Defend Customer Portal

A read-only, customer-facing security portal for managed Elastic Defend. It shows
endpoint health (Fleet agent **and** Elastic Defend), detections with investigation
status, and per-agent detection history, without giving customers access to Kibana. The
agent list and agent details page mirror Kibana Fleet; policy status uses Kibana Security's
Endpoints wording.

**One container serves one customer** and talks to Elastic with that customer's own
read-only API key. The browser only ever talks to the portal.

| Overview                                 | Detection detail (memory threat)             |
| ---------------------------------------- | -------------------------------------------- |
| ![](docs/screenshots/light-overview.png) | ![](docs/screenshots/dark-detail-memory.png) |

| Agents (Fleet-style)                   | Agent details (mock data)             |
| -------------------------------------- | ------------------------------------- |
| ![](docs/screenshots/light-agents.png) | ![](docs/screenshots/light-agent.png) |

> **Status:** MVP verified against a real Elastic 9.5.5 backend: real Fleet agents, the
> real Endpoint Security rule and per-tenant API keys (see [docs/LAB.md](docs/LAB.md)). Mock
> data stays the default for UI work. A real Elastic Defend host is the remaining step; see
> [docs/ELASTIC.md](docs/ELASTIC.md#still-to-verify-needs-a-real-elastic-defend-host).

## Quick start (lab, mock data)

Everything runs in Docker. You do not need Node on the host.

```bash
./scripts/lab-init.sh
```

This creates `secrets/<tenant>/` (session secret plus one demo user) for `acme` and
`globex`, and prints the generated demo passwords once.

```bash
docker compose up -d --build
```

- Acme portal: <http://localhost:3101> (user `acme.analyst`)
- Globex portal: <http://localhost:3102> (user `globex.analyst`)

The image build runs the type check and the unit tests, so a broken build never produces an image.

Run the HTTP-level tenant-isolation and read-only checks against the two running containers:

```bash
A_USER=acme.analyst A_PASS='…' B_USER=globex.analyst B_PASS='…' ./scripts/e2e-lab.sh
```

## Connecting to the lab Elastic stack

The project has its own Elastic 9.5.5 lab stack in `lab/`, with real Fleet agents, the real
Endpoint Security rule and per-tenant API keys. See [docs/LAB.md](docs/LAB.md) to start it.
Then run the portals against it:

```bash
docker compose -f compose.yaml -f compose.elastic.yaml up -d --build
```

## Development (in Docker)

```bash
docker run --rm -it -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/app -w /app node:24.22.1-alpine npm ci
```

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/app -w /app node:24.22.1-alpine sh -c 'npm run check && npm test'
```

```bash
docker run --rm -it -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/app -v "$PWD/secrets/acme:/run/secrets:ro" --env-file .env.example -e COOKIE_SECURE=false -p 5173:5173 -w /app node:24.22.1-alpine npx vite dev --host 0.0.0.0
```

The last command starts a dev server for one tenant on <http://localhost:5173> (tenant `acme`, mock data).

To hash a password for a users file:

```bash
docker run --rm -it -v "$PWD/scripts:/s:ro" node:24.22.1-alpine node /s/hash-password.mjs
```

## Configuration

| Variable                             | Required    | Meaning                                                                                                 |
| ------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------- |
| `TENANT_ID`                          | yes         | Portal tenant id; sessions are bound to it                                                              |
| `TENANT_NAME`                        | –           | Display name                                                                                            |
| `KIBANA_SPACE_ID`                    | –           | Customer's Kibana space (default: `TENANT_ID`)                                                          |
| `TENANT_AGENT_POLICY_IDS`            | yes         | Comma-separated Fleet agent policy ids of this customer                                                 |
| `TENANT_NAMESPACES`                  | yes         | Data-stream namespaces of this customer's policies                                                      |
| `ALERTS_INDEX`                       | –           | Default `.alerts-security.alerts-<space>`                                                               |
| `DATA_SOURCE`                        | –           | `mock` (default) or `elastic`                                                                           |
| `ELASTICSEARCH_URL`, `KIBANA_URL`    | elastic     | Backend URLs, reachable only from the container                                                         |
| `ELASTIC_API_KEY[_FILE]`             | elastic     | Tenant-specific read-only API key (encoded form)                                                        |
| `NODE_EXTRA_CA_CERTS`                | –           | CA bundle for the Elastic TLS certificates                                                              |
| `SESSION_SECRET[_FILE]`              | yes         | ≥ 32 characters; unique per container                                                                   |
| `PORTAL_USERS_FILE` / `PORTAL_USERS` | yes         | JSON `{user: scryptHash}` / `user:hash,…`                                                               |
| `ORIGIN`                             | recommended | Public origin(s), comma-separated, e.g. `https://portal.acme.example`; POSTs must come from one of them |
| `COOKIE_SECURE`                      | –           | `true` by default; `false` only for plain-HTTP lab                                                      |
| `SESSION_TTL_SECONDS`                | –           | Default 8 h                                                                                             |

Missing tenant policies or namespaces make the container **refuse to start** (fail closed).

## Documentation

- [Architecture, tenant isolation and auth](docs/ARCHITECTURE.md)
- [Elastic APIs, aliases, fields and privileges](docs/ELASTIC.md)
- [Dependencies and why they are trusted](docs/DEPENDENCIES.md)
- [Known limitations and production readiness](docs/PRODUCTION.md)
