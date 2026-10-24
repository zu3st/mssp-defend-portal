// Gives lab alerts realistic SOC workflow states through Kibana's own alert
// status API (as an analyst would): ~30% acknowledged, ~30% closed with a
// closing reason, rest open. Only touches alerts that are still open.
//
//   docker run --rm --network mssp-lab_default -v "$PWD":/app -w /app \
//     --env-file lab/.env node:24.22.1-alpine node lab/triage.mjs
const ES = 'http://elasticsearch:9200';
const KB = 'http://kibana:5601';
const auth = 'Basic ' + Buffer.from(`elastic:${process.env.ELASTIC_PASSWORD}`).toString('base64');
const REASONS = ['false_positive', 'true_positive', 'benign_positive', 'duplicate', 'other'];

for (const space of ['acme', 'globex']) {
	const res = await fetch(`${ES}/.alerts-security.alerts-${space}/_search?size=500&_source=false`, {
		method: 'POST',
		headers: { Authorization: auth, 'Content-Type': 'application/json' },
		body: JSON.stringify({ query: { term: { 'kibana.alert.workflow_status': 'open' } } })
	});
	const ids = (await res.json()).hits.hits.map((h) => h._id);
	const ack = [];
	const closed = new Map();
	for (const id of ids) {
		const r = Math.random();
		if (r < 0.3) ack.push(id);
		else if (r < 0.6) {
			const reason = REASONS[Math.floor(Math.random() * REASONS.length)];
			closed.set(reason, [...(closed.get(reason) ?? []), id]);
		}
	}
	const set = async (signal_ids, status, reason) =>
		signal_ids.length &&
		fetch(`${KB}/s/${space}/api/detection_engine/signals/status`, {
			method: 'POST',
			headers: {
				Authorization: auth,
				'Content-Type': 'application/json',
				'kbn-xsrf': 'lab',
				'elastic-api-version': '2023-10-31'
			},
			body: JSON.stringify({ signal_ids, status, ...(reason && { reason }) })
		}).then((r) => r.status);
	await set(ack, 'acknowledged');
	for (const [reason, list] of closed) await set(list, 'closed', reason);
	console.log(
		`${space}: ${ids.length} open -> ${ack.length} acknowledged, ${[...closed.values()].flat().length} closed`
	);
}
