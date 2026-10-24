# Known limitations and production readiness

## Known limitations (MVP)

- **Not yet run against real Elastic data.** Everything is validated against synthetic,
  Elastic-shaped fixtures. Work through the list in
  [ELASTIC.md](ELASTIC.md#to-verify-against-the-lab) first.
- **Overview Defend counts** come from paging through the tenant's agents (capped at 5,000
  per request, no cache). Large fleets need caching or a dedicated aggregation.
- **Agent version facet** pages through up to 5,000 agents and is cached for 60 s, because
  Fleet has no "distinct versions" API.
- **Agent list sorting** covers Fleet fields only. Sorting by alert count would need all
  agents joined with alert counts.
- **Alert paging** uses `from`/`size` up to 10,000 results. Deeper paging would need
  `search_after` and a point-in-time.
- **Alert search** uses case-insensitive wildcards over a small fixed field set. It is
  bounded but not tuned for very large indices.
- **Login rate limiting** is in memory and per container.
- **Relative times** are rendered on the server and are not live-updated.

## Production checklist (alongside ECK)

**Authentication / SSO**

- Use OIDC (Entra ID, Keycloak, …) in-app, or oauth2-proxy in front. Require an IdP
  group or claim equal to the container's tenant. The tenant itself still comes from
  config.
- Remove local users, or keep them only for break-glass access.

**Tenant mapping**

- One Deployment plus Secret per customer, generated from a single source of truth
  (customer → space, policies, namespaces).
- Use one namespace per customer in Fleet policies, so alias, DLS and namespace filters
  all line up.

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
  Kibana reachability). Neither exposes tenant data.

**Logging**

- Logs go to stdout as JSON and include login success and failure, Elastic unavailability,
  and `TENANT SCOPE VIOLATION`. Alert on the last one.
- Add a request id and access logs at the ingress.

**Monitoring**

- Track Elastic latency and error rate. Optionally export Prometheus metrics, which would
  add a dependency to evaluate.

**Scalability and rate limits**

- Each page load makes 2–5 Kibana/ES calls. Add a short TTL cache (10–30 s) for overview,
  facets and status counts.
- Run 1–2 replicas per tenant; the app is stateless apart from the login limiter.
- Watch Kibana load if there are many tenants.

**Version compatibility**

- Pin `elastic-api-version`.
- Run the normalizer tests against fixtures captured from each supported Elastic version.
- Re-verify Fleet, Endpoint and alerts field names on every stack upgrade.

## Recommended next steps

1. Run phase 1 discovery on the lab: stack version, spaces, policies, namespaces and
   alert samples. Turn real alert documents (sanitized) into normalizer test fixtures.
2. Create the per-tenant API keys and record which privileges were actually needed.
3. Run `compose.elastic.yaml` against the lab, then re-run `scripts/e2e-lab.sh` with real
   data.
4. Add OIDC.
5. Add caching for the overview.
6. Optionally add read-only views of endpoint policy and exclusions, behind the same
   scoping.
