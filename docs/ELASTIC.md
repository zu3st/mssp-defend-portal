# Elastic data sources

All access is read-only and uses the container's tenant-specific API key
(`Authorization: ApiKey …`). Kibana requests go to the space URL `/s/<space>/…`.

## APIs and indices used

| Purpose                            | Request                                                                                                                                  | Scope applied                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Agent list / search / sort / page  | `GET /s/<space>/api/fleet/agents?kuery=…&page=&perPage=&sortField=&sortOrder=&showInactive=true&withMetrics=true[&showUpgradeable=true]` | `policy_id:(tenant policies)` ANDed                  |
| Status summary bar                 | same, `perPage=1&getStatusSummary=true`, status filter removed                                                                           | policy kuery                                         |
| Tags filter options                | `GET /s/<space>/api/fleet/agents/tags?kuery=policy_id:(…)`                                                                               | policy kuery                                         |
| Upgrade available                  | `GET /api/fleet/agents/available_versions`                                                                                               | – (version list only)                                |
| Detection rule name for the flyout | `GET /s/<space>/api/detection_engine/rules?id=<kibana.alert.rule.uuid>` (cached 5 min)                                                   | space-scoped: other spaces' rules do not resolve     |
| Agent detail                       | `GET /s/<space>/api/fleet/agents/<id>`                                                                                                   | policy re-checked; foreign → 404                     |
| Status counts                      | `GET /s/<space>/api/fleet/agent_status?kuery=policy_id:(…)`                                                                              | policy kuery                                         |
| Policy names                       | `GET /s/<space>/api/fleet/agent_policies?kuery=ingest-agent-policies.id:(…)`                                                             | result filtered to tenant ids                        |
| Defend policy response / isolation | `GET /s/<space>/api/endpoint/metadata?kuery=…`                                                                                           | policy + agent ids of the current page               |
| Alerts list, detail, aggregations  | `POST /.alerts-security.alerts-<space>/_search`                                                                                          | `kibana.space_ids` + `data_stream.namespace` filters |
| Readiness                          | `GET /api/status`                                                                                                                        | –                                                    |

Fleet already calculates and normalizes agent status. Using its API avoids reading the
internal `.fleet-*` indices. The Endpoint metadata API supplies what Fleet does not: the
endpoint policy response and isolation state.

Pagination is server-side everywhere:

- Fleet uses `page`/`perPage`.
- Alerts use `from`/`size`, capped at the 10,000 result window. The UI shows "+" when the
  total is a lower bound.

Page sizes are restricted to 10, 25, 50 and 100.

## Alert fields used

**Common**

- `@timestamp`, `message`
- `kibana.alert.{uuid,severity,risk_score,workflow_status,workflow_reason,workflow_status_updated_at,workflow_assignee_ids,reason}`
- `kibana.alert.rule.{name,description,threat}`
- `kibana.alert.original_event.{module,code,action,type}`
- `data_stream.namespace`, `kibana.space_ids`
- `agent.id`, `host.{id,name,hostname,ip,os.name,os.full}`, `user.{name,domain}`
- `source.ip`, `destination.ip`
- `process.{name,executable,pid,command_line,hash.sha256,code_signature.*,Ext.user}`,
  `process.parent.{name,executable,pid,command_line}`

**By detection type** (derived from `event.code`)

| Type           | `event.code`                           | Extra fields                                                                                                                      |
| -------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Malicious file | `malicious_file`                       | `file.{name,path,size,hash.sha256,code_signature.*}`, `file.Ext.{quarantine_result,quarantine_path,malware_classification.score}` |
| Memory threat  | `memory_signature`, `shellcode_thread` | `Target.process.{name,pid,executable}`, `Memory_protection.{feature,self_injection,cross_session}`, `rule.name`                   |
| Ransomware     | `ransomware`                           | `Ransomware.{feature,files.path,files.count}`                                                                                     |
| Behavior       | `behavior`                             | `rule.{name,description}`, `threat[].tactic/technique`                                                                            |
| Other rules    | – (non-endpoint)                       | `kibana.alert.rule.*`, process, file and network if present                                                                       |

Kibana writes `kibana.*` as dotted keys, while copied ECS fields are nested objects, and
some documents mix both forms (`"process.parent": {…}`). `field()` in
`src/lib/server/elastic/raw.ts` reads every form. The mock data contains all of them.

## Per-tenant API key

Create the key as a user who holds at least these privileges. It is created once per
customer and stored only in that customer's container secret.

```json
POST /_security/api_key
{
  "name": "portal-acme",
  "role_descriptors": {
    "portal_acme_read": {
      "cluster": [],
      "indices": [{
        "names": [".alerts-security.alerts-acme"],
        "privileges": ["read"],
        "query": { "bool": { "filter": [
          { "term":  { "kibana.space_ids": "acme" } },
          { "terms": { "data_stream.namespace": ["acme"] } }
        ] } }
      },
      {
        "names": ["metrics-elastic_agent.*-acme"],
        "privileges": ["read"]
      }],
      "applications": [{
        "application": "kibana-.kibana",
        "privileges": ["feature_fleetv2.read", "feature_fleet.read", "feature_siemV5.read", "feature_securitySolutionRulesV4.read", "feature_siemV5.endpoint_list_read"],
        "resources": ["space:acme"]
      }]
    }
  },
  "metadata": { "portal_tenant": "acme" }
}
```

The `query` adds Elasticsearch-enforced document-level security on top of the portal's own
filters. Use the `encoded` value from the response as `ELASTIC_API_KEY`.

## Verified against the lab (Elastic 9.5.5)

Checked on the project's lab stack (`lab/`, see [LAB.md](LAB.md)): real Fleet agents in
two space-aware tenants, real Endpoint Security rule, portal using per-tenant API keys.

| Item                                              | Result                                                                                                                                                                                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack version, Fleet space awareness              | 9.5.5; space awareness on by default; space-scoped Fleet/Kibana URLs work with tenant keys                                                                                                                                                      |
| `kibana.alert.rule.name` override                 | **Confirmed**: Endpoint Security uses `rule_name_override: message`                                                                                                                                                                             |
| Source rule identity                              | **Confirmed**: `kibana.alert.rule.uuid` plus `kibana.alert.rule.rule_id`; name resolved via `GET /s/<space>/api/detection_engine/rules?id=`                                                                                                     |
| Closing reason field                              | **Confirmed**: Kibana's status API writes `kibana.alert.workflow_reason` (e.g. `false_positive`)                                                                                                                                                |
| `data_stream.namespace` on promoted Defend alerts | **Confirmed**: kept on the alert, plus `kibana.alert.original_data_stream.namespace`                                                                                                                                                            |
| Cross-tenant leak                                 | **Confirmed real**: each space's Endpoint Security rule reads `logs-endpoint.alerts-*`, so acme's index held 15 globex alerts and globex's held 45 acme alerts. Namespace filter and DLS hide them; portal totals matched ground truth exactly. |
| Severity / risk score                             | Mapped by the rule from `event.severity` / `event.risk_score` of the Defend document                                                                                                                                                            |
| Kibana privileges for the tenant key              | `feature_fleetv2.read`, `feature_fleet.read`, `feature_siemV5.read` (+ `endpoint_list_read`), `feature_securitySolutionRulesV4.read`. Feature ids are versioned; `lab/setup.mjs` picks the newest.                                              |
| Fleet `withMetrics`                               | **Works only with** read on the tenant's `metrics-elastic_agent.*-<namespace>`; otherwise Fleet returns `metrics: {}`                                                                                                                           |
| `getStatusSummary`, `showUpgradeable`, tags API   | Work with the tenant key on the space-scoped URL                                                                                                                                                                                                |
| `available_versions`                              | Needs the space-scoped URL with a tenant key (403 on the global URL)                                                                                                                                                                            |
| Agent policy name lookup                          | The `ingest-agent-policies.id` kuery matches nothing on space-aware Fleet; the portal now lists the space's policies and filters                                                                                                                |
| Defend unit failure → Fleet status                | **Confirmed**: endpoint unit `FAILED` puts the agent in `degraded` (shown as Unhealthy)                                                                                                                                                         |
| Memory signature name                             | Per Kibana's generator: `process.Ext.malware_signature.all_names`, not `rule.name`                                                                                                                                                              |

## Still to verify (needs a real Elastic Defend host)

Elastic Defend cannot run in a container (`Elastic Agent must be running as root`), so the
following need the VM step in [LAB.md](LAB.md):

1. **Endpoint metadata API** (policy response, isolation) and its `united.*` kuery fields.
   Without Defend metadata the portal shows policy status "Unknown".
2. **Prevention signals** of real behavior, memory and ransomware alerts (the malware
   sample confirms `event.type: denied` and quarantine for malware).
3. **Ransomware alert fields**: no official sample exists; the lab feeder models them.
4. **Custom (non-Defend) rules**: whether their alerts carry `data_stream.namespace`. If
   not, they are hidden (fail closed) and the scope filter needs an `agent.id` fallback.
