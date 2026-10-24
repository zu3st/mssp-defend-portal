#!/bin/sh
# Lists the lab's Fleet agents per tenant space, with their Elastic Defend component.
#   lab/agents.sh            # table
#   lab/agents.sh --count    # number of enrolled (non-updating) tenant agents
set -eu
cd "$(dirname "$0")"
set -a; . ./.env; set +a
docker run --rm --network mssp-lab_default -e ELASTIC_PASSWORD -e MODE="${1:-}" node:24.22.1-alpine node --input-type=module -e '
const auth = "Basic " + Buffer.from("elastic:" + process.env.ELASTIC_PASSWORD).toString("base64");
let settled = 0;
for (const space of ["acme", "globex"]) {
  const r = await fetch(`http://kibana:5601/s/${space}/api/fleet/agents?showInactive=true&perPage=100`, {
    headers: { Authorization: auth, "elastic-api-version": "2023-10-31" }
  });
  const { items = [] } = await r.json();
  for (const a of items) {
    if (a.status !== "updating" && a.status !== "enrolling") settled++;
    if (process.env.MODE === "--count") continue;
    const ep = (a.components ?? []).find((c) => c.type === "endpoint");
    console.log([space, a.local_metadata?.host?.hostname, a.status, a.policy_id,
      ep ? `defend=${ep.status}: ${(ep.message ?? "").slice(0, 90)}` : "no defend"].join(" | "));
  }
}
if (process.env.MODE === "--count") console.log(settled);
'
