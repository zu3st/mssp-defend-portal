# Lab: real Elastic backend

A dedicated Elastic **9.5.5** stack for this project (trial license), isolated from any
other stack on the machine: own Compose project `mssp-lab`, own network and volume, host
ports `127.0.0.1:9201` (Elasticsearch) and `127.0.0.1:5602` (Kibana).

## What it contains

- **Elasticsearch, Kibana, Fleet Server** (`lab/compose.yaml`, `lab/kibana.yml`).
- **Two tenants** created by `lab/setup.mjs` (idempotent):

  | Tenant     | Kibana space | Agent policies (namespace)                   | Elastic Defend  |
  | ---------- | ------------ | -------------------------------------------- | --------------- |
  | Acme Corp  | `acme`       | `acme-workstations`, `acme-servers` (`acme`) | on workstations |
  | Globex Inc | `globex`     | `globex-endpoints` (`globex`)                | on endpoints    |

- **The prebuilt _Endpoint Security (Elastic Defend)_ rule**, installed and enabled in each
  space (1-minute interval, 2-minute lookback).
- **Per-tenant read-only API keys** in `secrets/<tenant>/elastic_api_key` for the portal.
- **Four real Fleet agents** (containers): `ACME-WS-001`, `ACME-WS-002`, `ACME-SRV-001` and
  `GLBX-WS-001`. Defend can't run in a container, so on the Defend policies its component
  reports `FAILED` and Fleet shows the agent as degraded, which is a realistic case.

## Alerts

`lab/feed-alerts.mjs` writes Elastic Defend-format alert documents for the real agents
into `logs-endpoint.alerts-<namespace>`. The **real** Endpoint Security rule then turns them
into Kibana alerts, so the portal reads genuine alerts-as-data documents: rule-name
override, `kibana.alert.*` fields, workflow state.

| Type                          | Source of the document                                                                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Malware                       | Official [endpoint-package sample](https://github.com/elastic/endpoint-package/blob/main/package/endpoint/data_stream/alerts/sample_event.json) (real capture), identity and timing rewritten |
| Memory (signature, shellcode) | Structure of Kibana 9.5.5 `EndpointDocGenerator.generateMemoryAlert`                                                                                                                          |
| Behavior                      | Structure of Kibana 9.5.5 `EndpointDocGenerator.generateBehaviorAlert`                                                                                                                        |
| Ransomware                    | **Modelled**: no official sample                                                                                                                                                              |

Timestamps must be current, because the rule only looks back 2 minutes.
`lab/triage.mjs` acknowledges and closes some alerts, with reasons, through Kibana's own
status API.

## Run it

Everything runs in Docker.

```bash
./lab/init.sh
```

```bash
docker compose -f lab/compose.yaml up -d
```

```bash
docker run --rm -u "$(id -u):$(id -g)" --network mssp-lab_default -v "$PWD":/app -w /app --env-file lab/.env node:24.22.1-alpine node lab/setup.mjs
```

```bash
docker compose -f lab/compose.yaml --profile agents up -d
```

```bash
./lab/agents.sh
```

```bash
docker run --rm --network mssp-lab_default -v "$PWD":/app -w /app --env-file lab/.env node:24.22.1-alpine node lab/feed-alerts.mjs 5
```

```bash
docker run --rm --network mssp-lab_default -v "$PWD":/app -w /app --env-file lab/.env node:24.22.1-alpine node lab/triage.mjs
```

Wait about a minute after feeding before triaging, so the rule has promoted the documents.
Then start the portals against the lab:

```bash
docker compose -f compose.yaml -f compose.elastic.yaml up -d --build
```

Kibana for the lab admin: <http://localhost:5602>. The user is `elastic`, and the password
is in `lab/.env`.

## Next: a real Elastic Defend host

For full fidelity (Defend health, policy response, isolation, genuine behavior and memory
alerts), enroll a VMware VM (Windows or Ubuntu) into `acme-workstations`:

1. Publish Fleet Server on a host port the VM can reach. Port 8221 was refused on this
   machine, likely a Windows-reserved range, so pick another.
2. Install Elastic Agent 9.5.5 on the VM with the `ACME_WORKSTATIONS_TOKEN` from
   `lab/.env`.
3. Trigger a malware alert with the EICAR test file, and a behavior alert with a benign
   Atomic Red Team test.
