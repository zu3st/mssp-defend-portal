# Architecture

```
 Browser ──HTTPS──▶  portal-<tenant> container (SvelteKit, adapter-node)
                      │  hooks.server.ts   auth, read-only guard, security headers
                      │  routes/*          page loads + /api/alerts/[id]
                      │  Portal            tenant-bound service: scope checks, normalization
                      │  DataSource        MockDataSource | ElasticDataSource
                      ▼
          Kibana Fleet / Endpoint APIs (space URL)  +  ES .alerts-security.alerts-<space>
                      (tenant-specific read-only API key)

 Browser ──sign-in──▶ idm-<tenant> (Kanidm, one per customer) ──OIDC code──▶ portal-<tenant>
```

- **One container serves one tenant.** The tenant (space, policies, namespaces, alias)
  comes from the container environment and is held by a single `Portal` instance.
- **Single service.** SvelteKit renders the UI on the server and serves the data loads and
  one small JSON endpoint (`/api/alerts/:id` for the side panel).
- **Browser boundary.** The CSP limits `connect-src` to `'self'`. Elastic URLs and keys exist
  only in server modules (`src/lib/server/**`), which SvelteKit refuses to bundle for the
  client.

## Code layout

| Path                         | Purpose                                                                |
| ---------------------------- | ---------------------------------------------------------------------- |
| `src/lib/contract.ts`        | Normalized data contract: the only shapes the browser receives         |
| `src/lib/server/config.ts`   | Env parsing, tenant scope, fail-closed validation                      |
| `src/lib/server/portal.ts`   | Tenant-bound facade used by all routes; second-layer scope checks      |
| `src/lib/server/params.ts`   | Strict URL-parameter parsing (allowlists, clamps, date validation)     |
| `src/lib/server/auth.ts`     | Signed session cookie bound to the tenant                              |
| `src/lib/server/oidc.ts`     | Sign-in at the tenant's Kanidm (authorization code flow, PKCE)         |
| `src/lib/server/normalize/*` | Raw Elastic → contract, per detection type                             |
| `src/lib/server/elastic/*`   | Read-only HTTP client, KQL/DSL builders, real data source              |
| `src/lib/server/mock/*`      | Generated Elastic-shaped multi-customer cluster + in-memory source     |
| `src/lib/range.ts`           | Time ranges as Kibana's date picker offers them: labels, URL, cookie   |
| `src/lib/refresh.ts`         | Auto-refresh that waits while the user is reading or typing            |
| `src/lib/components/**`      | UI components: tables, filters, time picker, alert flyout              |
| `src/routes/**`              | Overview, Detections, Agents (Fleet-style list + agent details), Login |

## Tenant isolation (defence in depth)

1. **Credential.** Each container uses its own API key. On the Elasticsearch side the key's
   role should be limited to the tenant's alerts alias, with a document-level-security
   query. On the Kibana side it should be limited to the tenant's space with read-only
   feature privileges (see [ELASTIC.md](ELASTIC.md#per-tenant-api-key)).
2. **Query scope.** Every query is built with the tenant filter ANDed in:
   - Fleet: `policy_id:(…tenant policies…)` on the space-scoped Kibana URL.
   - Alerts: the space alias as the index, plus `kibana.space_ids = <space>`, plus
     `data_stream.namespace ∈ tenant namespaces`.

   The namespace filter matters because a space-wide _Endpoint Security_ rule can copy
   other customers' Defend alerts into a space.

3. **Result verification.** `Portal` re-checks every returned agent (policy), endpoint
   metadata record (agent id) and alert (space and namespace). A foreign record raises
   `ScopeViolationError`: the request fails with an opaque 500 and a server log line.
4. **Request input never authorizes.** Browser-supplied `policy` filters can only narrow
   the tenant's own policies; a filter with only other tenants' policies returns no results.
   Parameters such as `space`, `index` or `tenant` are ignored. Another tenant's agent or
   alert id returns 404, like a missing one.
5. **Separate sign-in.** Each customer signs in at its own Kanidm, which issues tokens
   for its portal only to members of `portal_users`. The portal accepts ID tokens only
   from its configured issuer, for its own client id, and from members of
   `OIDC_REQUIRED_GROUP`.
6. **Session binding.** Session cookies are HMAC-signed with a per-container secret and
   carry the tenant id. A cookie from another tenant's container is rejected even if both
   containers were misconfigured with the same secret.

The tests cover each layer:

- `src/lib/server/isolation.spec.ts`: two tenants over the same mock cluster, other
  tenants' alerts in a tenant's alert index, id probing, crafted parameters, a deliberately
  buggy source, and config fail-closed.
- `scripts/e2e-lab.sh`: the same attacks over HTTP against two running containers.

## Read-only guarantees

- The HTTP client checks every Elastic request against an allowlist (GET on Fleet and
  Endpoint list/read routes, POST only to `<alerts alias>/_search`). Anything else throws
  before it is sent (see the `read-only request allowlist` tests).
- The portal accepts only GET/HEAD, except the sign-out form (405 otherwise). That POST
  must carry this container's `ORIGIN`.

## Authentication

- **One Kanidm per customer.** Users, passwords and sign-up links live there; the portal
  stores no credentials. A new user gets a link to choose a password, which works once
  and expires after 24 hours.
- **OpenID Connect.** _Sign in_ sends the browser to Kanidm with an authorization code
  request (PKCE, state and nonce). PKCE verifier, state, nonce and the page to return to
  wait in a signed cookie for 10 minutes. The callback redeems the code with the client
  secret and checks the ID token's issuer, audience, nonce and expiry, then the group
  (`oauth4webapi`). Kanidm's metadata is fetched on the first sign-in and kept.
- **Session.** After sign-in the portal issues its own stateless signed cookie
  (`HttpOnly`, `SameSite=Lax`, `Secure` unless disabled for testing over plain HTTP) for
  `SESSION_TTL_SECONDS`. `Lax` lets the browser send it on the redirect back from Kanidm;
  the one POST, sign-out, must carry this container's `ORIGIN`. Disabling a user in
  Kanidm stops new sign-ins; an open portal session runs until it expires.
- **Sign-out** ends the portal session. Kanidm keeps its own session, so the next _Sign
  in_ in that browser may go straight through.

## Time range and refresh

- **One time range for every view**, like Kibana's global time. Overview, Detections and an
  agent's Detections tab share Kibana's date picker (Quick select, Commonly used, a custom
  date range). The default is the last 7 days. A range in the URL wins, so links stay
  shareable; otherwise the last pick, kept for the browser session in the `range` cookie.
- **Calendar ranges follow the browser's time zone.** _Today_, _This week_ (from Monday) and
  custom dates start at local midnight; the browser sends its zone in the `tz` cookie, and
  the server falls back to UTC. Ranges are capped at 366 days.
- **Refresh.** The picker's _Refresh every_ is off by default (at least 10 seconds). The
  Agents list and agent details refresh every 30 seconds on their own, as Fleet does. A
  refresh reloads data in place and waits while the tab is hidden or the user is busy (alert
  flyout, an open dropdown or menu, typing).
- `range`, `tz` and `theme` are display preferences; the server validates each before use.

## Load on Elastic

Live data is never cached, so Refresh always shows the current state: agent lists, status
counts, agent details, alert searches and aggregations. Slow-changing data is kept in memory
per container (`src/lib/server/cache.ts`):

| Data                                                          | Kept for | Why                                             |
| ------------------------------------------------------------- | -------- | ----------------------------------------------- |
| Overview Elastic Defend counts and "Agents needing attention" | 30 s     | Reads every agent (up to 5,000) in pages of 500 |
| Version and tag filter options                                | 5 min    | One Fleet request per distinct version          |
| Agent policy names                                            | 5 min    | Renamed rarely                                  |
| Detection rule names                                          | 5 min    | Renamed rarely                                  |
| Versions Fleet can upgrade to                                 | 1 h      | Change with Elastic releases                    |

- **Shared loads.** Requests for an entry that is still loading wait for that load, so
  several tabs refreshing at once cost one sweep.
- **Failures are not kept**, except for the two best-effort lookups (rule names, upgrade
  versions), which are retried after a minute instead of on every page.
- **Bounded.** Rule names are looked up at most four at a time, and the Defend sweep asks
  Fleet for no CPU/memory metrics because it does not show them.
- Cached responses still pass the tenant checks on every request.

## Normalization rules

- **Response allowlist.** `_source.includes` requests only the fields in
  `ALERT_SOURCE_FIELDS`. Normalizers copy only contract fields, so internal metadata (rule
  parameters, execution ids, space ids, artifacts) stays on the server (tested).
- **Missing data.** Missing values are omitted. A few type-relevant fields are shown as
  _Not available_. Nothing is inferred.
- **Investigation status** is `kibana.alert.workflow_status` (open, acknowledged or closed;
  missing means open). The **closing reason** is a separate optional field that is shown
  only for closed alerts.
- **Alert flyout mirrors Kibana's Overview tab.** It shows the header, the Status, Risk score
  and Assignees cards, About (rule description, alert reason, MITRE ATT&CK) and
  Investigation → Highlighted fields. Unlike Kibana, the rules behind the alert sit right
  under the title: the Elastic Defend rule (`rule.name`) and the Kibana detection rule,
  whose name is looked up from `kibana.alert.rule.uuid` because the Endpoint Security
  rule's name override replaces it in the alert. Highlighted fields are a per-detection-type
  list of ECS fields built server-side from the allowlist. Assignees
  are shown as a count only (resolving names would need security-profile privileges, and
  the analysts' identities are internal).
- **Two statuses, as in Kibana Security → Endpoints.** _Agent status_ is Fleet's calculated
  agent status. _Policy status_ is the Elastic Defend policy response
  (`Endpoint.policy.applied.status`: Success, Warning or Failure; Unknown without a response;
  Not installed without Defend). Like Kibana, the last reported policy status is kept for
  offline agents. The portal does not claim "protected": a successful policy response only
  means the policy applied. The Defend component's own message (e.g. why it failed) is shown
  on the agent details page and as the reason in _Agents needing attention_.
- **Outcome** is _Prevented_ only for explicit Defend signals (`event.type: denied`,
  `rule_prevention`, quarantine, _Prevention Alert_ message). Otherwise it is _Detected only_
  or _Not reported_.
- **Correlation** between hosts, agents and alerts uses `agent.id`, never hostname alone.
