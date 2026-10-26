# Lab: real Elastic backend

An Elastic **9.5.5** stack for this project (trial license) with its own Compose project
`mssp-lab`, network and volume, on `127.0.0.1:9201` (Elasticsearch) and
`127.0.0.1:5602` (Kibana).

## What it contains

- **Elasticsearch, Kibana, Fleet Server** (`lab/compose.yaml`, `lab/kibana.yml`).
- **Two tenants** created by `lab/setup.mjs` (idempotent):

  | Tenant     | Kibana space | Agent policies (namespace)                   | Elastic Defend  |
  | ---------- | ------------ | -------------------------------------------- | --------------- |
  | Acme Corp  | `acme`       | `acme-workstations`, `acme-servers` (`acme`) | on workstations |
  | Globex Inc | `globex`     | `globex-endpoints` (`globex`)                | on endpoints    |

- **The prebuilt _Endpoint Security (Elastic Defend)_ rule**, installed and enabled in each
  space (1-minute interval, 2-minute lookback). Each space's rules are limited to its
  tenant's namespace (`securitySolution:includedDataStreamNamespacesForRuleExecution`).
- **Per-tenant read-only API keys** in `secrets/<tenant>/elastic_api_key` for the portal.
- **Four real Fleet agents** (containers): `ACME-WS-001`, `ACME-WS-002`, `ACME-SRV-001` and
  `GLBX-WS-001`. Defend can't run in a container, so on the Defend policies its component
  reports `FAILED` and Fleet shows the agent as degraded.

## Alerts

`lab/feed-alerts.mjs` writes Elastic Defend-format alert documents for the real agents
into `logs-endpoint.alerts-<namespace>`. The Endpoint Security rule then turns them into
Kibana alerts, so the portal reads alerts as Kibana writes them: rule-name override,
`kibana.alert.*` fields, workflow state.

| Type                          | Source of the document                                                                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Malware                       | Official [endpoint-package sample](https://github.com/elastic/endpoint-package/blob/main/package/endpoint/data_stream/alerts/sample_event.json) (real capture), identity and timing rewritten      |
| Memory (signature, shellcode) | Structure of Kibana 9.5.5 `EndpointDocGenerator.generateMemoryAlert`                                                                                                                               |
| Behavior                      | Structure of Kibana 9.5.5 `EndpointDocGenerator.generateBehaviorAlert`                                                                                                                             |
| Ransomware                    | Shape of a real Elastic Defend 9.5.5 canary alert from the lab VM (see [ELASTIC.md](ELASTIC.md#verified-on-a-real-elastic-defend-host-windows-server-2025-elastic-955)); no official sample exists |

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

## Real Elastic Defend host (VMware)

Elastic Defend can't run in the lab's agent containers. Verified with a Windows Server 2025
VM on a host-only VMware network (results in [ELASTIC.md](ELASTIC.md#verified-on-a-real-elastic-defend-host-windows-server-2025-elastic-955)):

1. **Reach the lab from the VM.** Relay Fleet Server and Elasticsearch to the host-only
   address (here `192.168.126.1`), and map the names the lab policies use in the VM's
   `hosts` file:

   ```bash
   docker run -d --name mssp-lab-vm-relay --network mssp-lab_default \
     -p 192.168.126.1:8220:8220 -p 192.168.126.1:9200:9200 --entrypoint sh alpine:3.22 \
     -c 'apk add -q --no-cache socat && (socat TCP-LISTEN:8220,fork,reuseaddr TCP:fleet-server:8220 & socat TCP-LISTEN:9200,fork,reuseaddr TCP:elasticsearch:9200)'
   ```

   ```text
   192.168.126.1 fleet-server
   192.168.126.1 elasticsearch
   ```

2. **Install** Elastic Agent 9.5.5 (official zip from `artifacts.elastic.co`, SHA-512
   checked; it bundles `endpoint-security.exe`, so an offline VM needs nothing else):

   ```powershell
   elastic-agent.exe install --non-interactive --insecure --url=http://fleet-server:8220 --enrollment-token=<ACME_WORKSTATIONS_TOKEN>
   ```

   In a PowerShell script with `$ErrorActionPreference = 'Stop'`, the agent's progress
   output on stderr aborts the install before enrollment; then run `elastic-agent.exe enroll`
   with the same arguments.

3. **Trigger alerts** with benign techniques Microsoft Defender does not block on a server,
   e.g. `cmd.exe` copied as `svchost.exe` into `C:\Users\Public\…` and run, or a scheduled
   task pointing there. Elastic Defend prevents them and writes behavior alerts within
   seconds; the Endpoint Security rule promotes them within a minute.
   - **Ransomware:** back up the canaries in `C:\aaAntiRansomElastic-DO-NOT-TOUCH-…` and
     `C:\zzAntiRansomElastic-DO-NOT-TOUCH-…`, XOR them in place from a separate process (Defend
     kills it), then XOR the changed ones back (Defend kills that too, so repeat) and compare
     with the backed-up hashes.
   - **Malware (EICAR):** on a server Microsoft Defender catches EICAR first. Have the VM's
     admin add an exclusion for one test folder
     (`Add-MpPreference -ExclusionPath C:\MsspEicarTest`), write EICAR there, and remove the
     exclusion afterwards (`Remove-MpPreference`).
4. **Isolate and release** the host from Kibana (Security → Endpoints, or
   `POST /s/acme/api/endpoint/action/isolate` / `unisolate`) to check the isolation display.
5. **Remove it again**: `elastic-agent.exe uninstall --force` on the VM, remove the `hosts`
   lines, unenroll the agent in Fleet (`POST /s/acme/api/fleet/agents/<id>/unenroll` with
   `{"revoke": true}`) and `docker rm -f mssp-lab-vm-relay`.
