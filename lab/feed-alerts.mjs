// Feeds Elastic Defend-format alert documents for the lab's real Fleet agents
// into logs-endpoint.alerts-<namespace>. The prebuilt "Endpoint Security
// (Elastic Defend)" rule (enabled per space by lab/setup.mjs, 1m interval,
// 2m lookback) then promotes them into each space's alerts index, so the
// portal reads genuine alerts-as-data documents.
//
//   docker run --rm --network mssp-lab_default -v "$PWD":/app -w /app \
//     --env-file lab/.env node:24.22.1-alpine node lab/feed-alerts.mjs [rounds]
//
// Provenance of the source documents (see lab/samples/README.md):
//   malware     - official elastic/endpoint-package sample (real capture), identity/timing rewritten
//   memory      - structure of Kibana 9.5.5 EndpointDocGenerator.generateMemoryAlert
//   behavior    - structure of Kibana 9.5.5 EndpointDocGenerator.generateBehaviorAlert
//   ransomware  - shape of a real Defend 9.5.5 canary alert from the lab VM (no official sample)
import { readFileSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';

const ES = 'http://elasticsearch:9200';
const KB = 'http://kibana:5601';
const auth = 'Basic ' + Buffer.from(`elastic:${process.env.ELASTIC_PASSWORD}`).toString('base64');
const SPACES = ['acme', 'globex'];
const MALWARE = JSON.parse(readFileSync('lab/samples/endpoint-package-malware-alert.json', 'utf8'));

const hex = (n) => randomBytes(n).toString('hex');
const pick = (a) => a[Math.floor(Math.random() * a.length)];

async function agentsOf(space) {
	const r = await fetch(`${KB}/s/${space}/api/fleet/agents?perPage=100`, {
		headers: { Authorization: auth, 'elastic-api-version': '2023-10-31' }
	});
	const { items = [] } = await r.json();
	const policies = await (
		await fetch(`${KB}/s/${space}/api/fleet/agent_policies?perPage=100`, {
			headers: { Authorization: auth, 'elastic-api-version': '2023-10-31' }
		})
	).json();
	const ns = new Map((policies.items ?? []).map((p) => [p.id, p.namespace]));
	return items.map((a) => ({ agent: a, namespace: ns.get(a.policy_id) ?? 'default' }));
}

/** Identity block shared by every alert, taken from the real Fleet agent. */
function identity({ agent }, ts, user) {
	const h = agent.local_metadata?.host ?? {};
	const os = agent.local_metadata?.os ?? {};
	return {
		'@timestamp': ts,
		agent: {
			id: agent.id,
			type: 'endpoint',
			version: agent.agent?.version ?? agent.local_metadata?.elastic?.agent?.version
		},
		elastic: { agent: { id: agent.id } },
		host: {
			hostname: h.hostname,
			name: h.hostname,
			id: h.id,
			ip: h.ip,
			mac: h.mac,
			architecture: h.architecture,
			os: {
				name: os.name,
				family: os.family,
				platform: os.platform,
				version: os.version,
				full: os.full,
				kernel: os.kernel
			}
		},
		user: { name: user, domain: h.hostname?.split('-')[0] ?? 'LAB' }
	};
}

/** Defend sets event.severity/risk_score; the rule's severity/risk mappings read them. */
const SEVERITY = { low: 21, medium: 47, high: 73, critical: 99 };

function eventBase(code, category, prevented, extra = {}) {
	return {
		kind: 'alert',
		module: 'endpoint',
		dataset: 'endpoint.alerts',
		code,
		category,
		id: hex(12),
		created: new Date().toISOString(),
		outcome: 'success',
		...extra,
		type: prevented ? ['info', 'denied'] : ['info', 'allowed']
	};
}

function malware(a, ts, prevented) {
	const doc = structuredClone(MALWARE);
	const id = identity(a, ts, pick(['jdoe', 'asmith', 'mmiller']));
	Object.assign(doc, id);
	const name = pick(['Invoice_8841.exe', 'Setup_Zoom_x64.exe', 'scan_2026-10-02.pdf.exe']);
	doc.message = prevented ? 'Malware Prevention Alert' : 'Malware Detection Alert';
	doc.event = {
		...doc.event,
		...eventBase('malicious_file', ['malware', 'intrusion_detection', 'file'], prevented, {
			action: doc.event.action
		})
	};
	doc.file.name = name;
	doc.file.path = `C:\\Users\\${id.user.name}\\Downloads\\${name}`;
	doc.file.hash = { ...doc.file.hash, sha256: hex(32), sha1: hex(20), md5: hex(16) };
	doc.file.Ext.quarantine_result = prevented;
	delete doc.event.ingested;
	delete doc.event.sequence;
	return doc;
}

function memory(a, ts, prevented, shellcode) {
	const id = identity(a, ts, 'SYSTEM');
	const sig = pick([
		'Windows.Trojan.CobaltStrike',
		'Windows.Trojan.Metasploit',
		'Windows.Hacktool.Mimikatz'
	]);
	return {
		...id,
		message: shellcode
			? `Memory Threat ${prevented ? 'Prevention' : 'Detection'} Alert: Shellcode Injection`
			: `Memory Threat ${prevented ? 'Prevention' : 'Detection'} Alert: ${sig}`,
		event: eventBase(
			shellcode ? 'shellcode_thread' : 'memory_signature',
			['malware', 'intrusion_detection'],
			prevented,
			{
				action: 'start',
				severity: shellcode ? SEVERITY.high : SEVERITY.critical,
				risk_score: shellcode ? SEVERITY.high : SEVERITY.critical
			}
		),
		Memory_protection: {
			feature: shellcode ? 'shellcode_thread' : 'signature',
			self_injection: !shellcode
		},
		process: {
			pid: 4000 + Math.floor(Math.random() * 4000),
			entity_id: hex(16),
			name: shellcode ? 'rundll32.exe' : 'powershell.exe',
			executable: shellcode
				? 'C:\\Windows\\System32\\rundll32.exe'
				: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
			command_line: shellcode
				? 'rundll32.exe C:\\ProgramData\\upd\\x64.dll,Start'
				: 'powershell.exe -nop -w hidden -c IEX ((new-object net.webclient).downloadstring(...))',
			parent: { pid: 600, name: shellcode ? 'explorer.exe' : 'cmd.exe' },
			Ext: {
				user: 'SYSTEM',
				...(shellcode
					? {}
					: {
							malware_signature: { all_names: sig, identifier: 'diagnostic-malware-signature-v1' }
						})
			}
		},
		...(shellcode
			? {
					Target: {
						process: {
							name: 'svchost.exe',
							pid: 900,
							executable: 'C:\\Windows\\System32\\svchost.exe',
							thread: {
								Ext: {
									start_address_details: { allocation_type: 'PRIVATE', region_protection: 'RWX' }
								}
							}
						}
					}
				}
			: {})
	};
}

const BEHAVIOR_RULES = [
	{
		name: 'Suspicious Microsoft Office Child Process',
		description:
			'Identifies a Microsoft Office application spawning a suspicious child process such as a script interpreter.',
		severity: SEVERITY.medium,
		tactic: ['TA0001', 'Initial Access'],
		technique: ['T1566.001', 'Spearphishing Attachment'],
		process: [
			'powershell.exe',
			'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
			'powershell.exe -nop -w hidden -enc SQBFAFgA'
		],
		parent: ['WINWORD.EXE', 'C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE']
	},
	{
		name: 'Potential Credential Access via LSASS Memory Dump',
		description:
			'Identifies an attempt to dump the memory of the LSASS process, commonly used to obtain credentials.',
		severity: SEVERITY.critical,
		tactic: ['TA0006', 'Credential Access'],
		technique: ['T1003.001', 'LSASS Memory'],
		process: [
			'rundll32.exe',
			'C:\\Windows\\System32\\rundll32.exe',
			'rundll32.exe C:\\Windows\\System32\\comsvcs.dll, MiniDump 712 C:\\Windows\\Temp\\out.dmp full'
		],
		parent: ['cmd.exe', 'C:\\Windows\\System32\\cmd.exe']
	}
];

function behavior(a, ts, prevented) {
	const r = pick(BEHAVIOR_RULES);
	return {
		...identity(a, ts, pick(['jdoe', 'asmith'])),
		message: `Malicious Behavior ${prevented ? 'Prevention' : 'Detection'} Alert: ${r.name}`,
		event: {
			...eventBase('behavior', ['malware', 'intrusion_detection'], prevented, {
				action: prevented ? 'rule_prevention' : 'rule_detection',
				severity: r.severity,
				risk_score: r.severity
			}),
			type: ['info']
		},
		rule: { id: randomUUID(), name: r.name, description: r.description, ruleset: 'production' },
		threat: [
			{
				framework: 'MITRE ATT&CK',
				tactic: { id: r.tactic[0], name: r.tactic[1] },
				technique: [{ id: r.technique[0], name: r.technique[1] }]
			}
		],
		process: {
			pid: 5000 + Math.floor(Math.random() * 3000),
			entity_id: hex(16),
			name: r.process[0],
			executable: r.process[1],
			command_line: r.process[2],
			parent: { pid: 700, name: r.parent[0], executable: r.parent[1] }
		}
	};
}

/** Shape of a real Defend 9.5.5 canary alert (lab, Windows Server 2025). */
function ransomware(a, ts, prevented) {
	const id = identity(a, ts, 'jdoe');
	const base = `C:\\Users\\${id.user.name}\\Documents`;
	return {
		...id,
		message: prevented ? 'Ransomware Prevention Alert' : 'Ransomware Detection Alert',
		event: eventBase('ransomware', ['malware', 'intrusion_detection', 'file'], prevented, {
			action: 'canary-activity',
			severity: SEVERITY.high,
			risk_score: SEVERITY.high
		}),
		Ransomware: {
			feature: 'canary',
			version: '1.9.0',
			files: [
				{
					path: `${base}\\Q3-financials.xlsx`,
					extension: 'xlsx',
					operation: 'overwrite',
					metrics: ['CANARY_ACTIVITY'],
					entropy: 4.11
				}
			]
		},
		process: {
			pid: 6100,
			entity_id: hex(16),
			name: 'svhost32.exe',
			executable: `C:\\Users\\${id.user.name}\\AppData\\Roaming\\svhost32.exe`,
			hash: { sha256: hex(32) },
			parent: { pid: 600, name: 'explorer.exe' }
		}
	};
}

const rounds = Number(process.argv[2] ?? 1);
let ops = '';
let count = 0;
for (let round = 0; round < rounds; round++) {
	for (const space of SPACES) {
		for (const a of await agentsOf(space)) {
			const ts = new Date(Date.now() - Math.floor(Math.random() * 45_000)).toISOString();
			const prevented = Math.random() < 0.6;
			const make = [
				() => malware(a, ts, prevented),
				() => memory(a, ts, prevented, false),
				() => memory(a, ts, prevented, true),
				() => behavior(a, ts, prevented),
				() => ransomware(a, ts, prevented)
			][(round + count) % 5];
			const doc = make();
			doc.data_stream = { type: 'logs', dataset: 'endpoint.alerts', namespace: a.namespace };
			ops +=
				JSON.stringify({ create: { _index: `logs-endpoint.alerts-${a.namespace}` } }) +
				'\n' +
				JSON.stringify(doc) +
				'\n';
			count++;
		}
	}
}
const res = await fetch(`${ES}/_bulk?refresh=true`, {
	method: 'POST',
	headers: { Authorization: auth, 'Content-Type': 'application/x-ndjson' },
	body: ops
});
const out = await res.json();
const failed = out.items?.filter((i) => i.create?.error) ?? [];
console.log(`indexed ${count - failed.length}/${count} Defend alert documents`);
for (const f of failed.slice(0, 3))
	console.log('  error:', JSON.stringify(f.create.error).slice(0, 300));
