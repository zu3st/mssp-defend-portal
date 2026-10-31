# Known limitations and production readiness

## Known limitations

- **Tested in a lab.** The portal ran against an Elastic 9.5.5 lab stack and an Elastic
  Defend host, not at production scale. The remaining checks are in
  [ELASTIC.md](ELASTIC.md#still-to-verify).
- **Overview Defend counts** come from paging through the tenant's agents (capped at 5,000,
  shared for 30 s). Very large fleets would need a dedicated aggregation.
- **Agent version filter** lists at most 50 distinct versions (see
  [ELASTIC.md](ELASTIC.md#apis-and-indices-used)).
- **Caches are per container.** Replicas of one tenant each keep their own (see
  [ARCHITECTURE.md](ARCHITECTURE.md#load-on-elastic)).
- **Agent list sorting** covers Fleet fields only. Sorting by alert count would need all
  agents joined with alert counts.
- **Alert paging** uses `from`/`size` up to 10,000 results. Deeper paging would need
  `search_after` and a point-in-time.
- **Alert search** uses case-insensitive wildcards over a small fixed field set. It is
  bounded but not tuned for very large indices.
- **Login throttling** is in memory and per container. Behind a proxy it needs
  `ADDRESS_HEADER` to see client IPs.
- **Relative times** ("2 minutes ago") change only when the page reloads its data: on
  navigation, Refresh, the time picker's auto-refresh, or the agent pages' 30-second refresh.

## Production checklist (alongside ECK)

**Authentication / SSO**

- Use OIDC (Entra ID, Keycloak, …) in-app, or oauth2-proxy in front. Require an IdP
  group or claim equal to the container's tenant.
- Remove local users, or keep them only for break-glass access.

**Tenant mapping**

- One Deployment plus Secret per customer, generated from a single source of truth
  (customer → space, policies, namespaces).
- Use one namespace per customer in Fleet policies, so alias, DLS and namespace filters
  all line up.
- Set each space's _Included data stream namespaces for rule execution_ to that customer's
  namespace; otherwise its detection rules read every customer's data (see
  [ELASTIC.md](ELASTIC.md#detection-rules-and-spaces)).

**Secrets**

- Mount the API key and session secret as Kubernetes Secrets (`*_FILE`). Consider External
  Secrets or Vault.
- Rotate API keys with an expiry, and give each key `metadata.portal_tenant`.

**TLS and network**

- Put an ingress in front with TLS, and set `ORIGIN` and `COOKIE_SECURE=true`.
- Add a NetworkPolicy: ingress only from the ingress controller; egress only to ES/Kibana
  services and DNS.
- Use the ECK CA via `NODE_EXTRA_CA_CERTS`.

**Container**

- The image is read-only-rootfs compatible and runs as non-root uid 1000 with no Linux
  capabilities (as in `compose.yaml`).
- Pin the image by digest.
- Add `securityContext`: `runAsNonRoot`, `readOnlyRootFilesystem`,
  `seccompProfile: RuntimeDefault`.

**Health**

- Use `/healthz` as the liveness probe and `/readyz` as the readiness probe (it checks
  Kibana reachability).

**Logging**

- Logs go to stdout as JSON and include login success and failure, Elastic unavailability,
  and `TENANT SCOPE VIOLATION`. Alert on the last one.
- Add a request id and access logs at the ingress.

**Monitoring**

- Track Elastic latency and error rate, optionally as Prometheus metrics.

**Scalability and rate limits**

- Each page load makes 2–5 Kibana/ES calls for live data; reference data and the overview's
  Defend sweep are cached (see [ARCHITECTURE.md](ARCHITECTURE.md#load-on-elastic)).
- Run 1–2 replicas per tenant; the app is stateless apart from the login limiter.
- Watch Kibana load if there are many tenants.

**Version compatibility**

- Run the normalizer tests against fixtures captured from each supported Elastic version.
- On every stack upgrade, re-verify Fleet, Endpoint and alert field names and the Kibana
  `elastic-api-version` the portal sends (`2023-10-31`).

## Recommended next steps

1. Add OIDC (see Authentication above).
2. Verify memory signature alerts from a real host (see
   [ELASTIC.md](ELASTIC.md#still-to-verify)).
3. Optionally add read-only views of endpoint policy and exclusions, behind the same
   scoping.
