import { describe, expect, it } from 'vitest';
import type { RawAlertHit } from '../elastic/raw';
import { field } from '../elastic/raw';
import {
	ALERT_SOURCE_FIELDS,
	alertOutcome,
	normalizeAlertDetail,
	normalizeAlertSummary
} from './alerts';

const hit = (src: Record<string, unknown>): RawAlertHit => ({
	_id: 'doc-id',
	_index: '.internal.alerts-security.alerts-acme-000001',
	_source: src
});

const common = {
	'@timestamp': '2026-10-20T10:00:00.000Z',
	'kibana.alert.uuid': 'a1',
	'kibana.alert.rule.name': 'Endpoint Security (Elastic Defend)',
	'kibana.alert.severity': 'high',
	'kibana.alert.risk_score': 73,
	'kibana.alert.workflow_status': 'open',
	'kibana.space_ids': ['acme'],
	'kibana.alert.original_event.module': 'endpoint',
	data_stream: { namespace: 'acme' },
	agent: { id: 'agent-1' },
	host: { name: 'ACME-WS-001', id: 'host-1', ip: ['10.10.50.10'], os: { full: 'Windows 11 Pro' } },
	user: { name: 'jdoe', domain: 'ACME' }
};

describe('field()', () => {
	it('reads nested, dotted and mixed paths', () => {
		const src = {
			'kibana.alert.severity': 'high',
			process: { parent: { name: 'a' } },
			'process.parent': { pid: 4 }
		};
		expect(field(src, 'kibana.alert.severity')).toBe('high');
		expect(field(src, 'process.parent.name')).toBe('a');
		expect(field(src, 'process.parent.pid')).toBe(4);
		expect(field(src, 'process.missing')).toBeUndefined();
	});
});

/** Highlighted fields as `{ field: values }` for compact assertions. */
const fields = (d: { highlighted: { field: string; values: string[] }[] }) =>
	Object.fromEntries(d.highlighted.map((h) => [h.field, h.values]));

describe('malicious file alert', () => {
	const src = {
		...common,
		message: 'Malware Prevention Alert',
		'kibana.alert.original_event.code': 'malicious_file',
		'kibana.alert.original_event.type': ['info', 'denied'],
		file: {
			name: 'Invoice_8841.exe',
			path: 'C:\\Users\\jdoe\\Downloads\\Invoice_8841.exe',
			hash: { sha256: 'ab'.repeat(32) },
			Ext: { quarantine_result: true, malware_classification: { score: 0.97 } }
		},
		process: { name: 'msedge.exe', pid: 4242 }
	};

	it('highlights file, hash, quarantine and process', () => {
		const d = normalizeAlertDetail(hit(src));
		expect(d.kind).toBe('malware');
		expect(d.outcome).toBe('prevented');
		expect(d.title).toBe('Malware Prevention Alert');
		expect(fields(d)).toEqual({
			'host.name': ['ACME-WS-001'],
			'user.name': ['jdoe'],
			'file.name': ['Invoice_8841.exe'],
			'file.path': ['C:\\Users\\jdoe\\Downloads\\Invoice_8841.exe'],
			'file.hash.sha256': ['ab'.repeat(32)],
			'file.Ext.quarantine_result': ['true'],
			'file.Ext.malware_classification.score': ['0.97'],
			'process.name': ['msedge.exe']
		});
		expect(d.agentId).toBe('agent-1');
		expect(d.subject).toBe('Invoice_8841.exe');
	});

	it('detection-mode alert is "detected"', () => {
		const s = {
			...src,
			message: 'Malware Detection Alert',
			'kibana.alert.original_event.type': ['info', 'allowed'],
			file: { name: 'x' }
		};
		expect(alertOutcome(s)).toBe('detected');
	});
});

describe('memory / shellcode alert', () => {
	it('exposes process, target and memory context', () => {
		const d = normalizeAlertDetail(
			hit({
				...common,
				'kibana.alert.original_event.code': 'shellcode_thread',
				'kibana.alert.original_event.type': ['info', 'denied'],
				process: { name: 'rundll32.exe', pid: 10, parent: { name: 'explorer.exe' } },
				// Shape of the real DC01 alert (Defend 9.5.5).
				Target: {
					process: {
						name: 'notepad.exe',
						pid: 800,
						Ext: { memory_region: { region_protection: 'RWX', allocation_type: 'PRIVATE' } },
						thread: { Ext: { start_address_module: 'Unbacked' } }
					}
				},
				Memory_protection: {
					feature: 'shellcode_thread',
					self_injection: false,
					cross_session: false,
					parent_to_child: true
				}
			})
		);
		expect(d.kind).toBe('memory');
		expect(fields(d)).toMatchObject({
			'Memory_protection.feature': ['shellcode_thread'],
			'Memory_protection.self_injection': ['false'],
			'Memory_protection.cross_session': ['false'],
			'Memory_protection.parent_to_child': ['true'],
			'process.name': ['rundll32.exe'],
			'process.parent.name': ['explorer.exe'],
			'Target.process.name': ['notepad.exe'],
			'Target.process.Ext.memory_region.region_protection': ['RWX'],
			'Target.process.Ext.memory_region.allocation_type': ['PRIVATE'],
			'Target.process.thread.Ext.start_address_module': ['Unbacked']
		});
		expect(d.outcome).toBe('prevented');
	});
});

describe('ransomware alert', () => {
	it('reads a real canary alert (one file object)', () => {
		// As written by Elastic Defend 9.5.5 on a Windows Server host in the lab.
		const d = normalizeAlertDetail(
			hit({
				...common,
				'kibana.alert.original_event.code': 'ransomware',
				'kibana.alert.original_event.action': 'canary-activity',
				'kibana.alert.original_event.type': ['info', 'start', 'change', 'denied'],
				Ransomware: {
					feature: 'canary',
					version: '1.9.0',
					files: {
						path: 'c:\\aaantiransomelastic-do-not-touch-x\\canary.docm',
						extension: 'docm',
						operation: 'overwrite',
						metrics: ['CANARY_ACTIVITY'],
						entropy: 4.11,
						data: '0A110E32'
					}
				},
				process: { name: 'powershell.exe' }
			})
		);
		expect(d.kind).toBe('ransomware');
		expect(fields(d)).toMatchObject({
			'Ransomware.feature': ['canary'],
			'Ransomware.files.path': ['c:\\aaantiransomelastic-do-not-touch-x\\canary.docm'],
			'Ransomware.files.operation': ['overwrite'],
			'Ransomware.files.metrics': ['CANARY_ACTIVITY']
		});
		// The raw file bytes are not on the allowlist.
		expect(JSON.stringify(d)).not.toContain('0A110E32');
		expect(d.outcome).toBe('prevented');
	});

	it('lists every path when several files are affected', () => {
		const d = normalizeAlertDetail(
			hit({
				...common,
				'kibana.alert.original_event.code': 'ransomware',
				Ransomware: {
					feature: 'canary',
					files: [
						{ path: 'C:\\a.docx', operation: 'overwrite' },
						{ path: 'C:\\b.xlsx', operation: 'rename' }
					]
				},
				process: { name: 'svhost32.exe' }
			})
		);
		expect(fields(d)['Ransomware.files.path']).toEqual(['C:\\a.docx', 'C:\\b.xlsx']);
		expect(fields(d)['Ransomware.files.operation']).toEqual(['overwrite', 'rename']);
		// No prevention signal present -> do not guess.
		expect(d.outcome).toBe('unknown');
	});
});

describe('behavior alert', () => {
	it('uses the Defend rule name, process tree and MITRE mapping', () => {
		const d = normalizeAlertDetail(
			hit({
				...common,
				'kibana.alert.original_event.code': 'behavior',
				'kibana.alert.original_event.action': 'rule_detection',
				rule: {
					name: 'Suspicious Microsoft Office Child Process',
					description: 'Office spawned a script interpreter.'
				},
				threat: [
					{
						tactic: { name: 'Initial Access' },
						technique: [{ id: 'T1566.001', name: 'Spearphishing Attachment' }]
					}
				],
				process: { name: 'powershell.exe', command_line: 'powershell -enc AAA' },
				'process.parent': { name: 'WINWORD.EXE' }
			})
		);
		expect(d.kind).toBe('behavior');
		expect(d.title).toBe('Suspicious Microsoft Office Child Process');
		expect(d.ruleName).toBe('Endpoint Security (Elastic Defend)');
		// The Defend rule is surfaced on its own, not buried in highlighted fields.
		expect(d.defendRule).toEqual({
			name: 'Suspicious Microsoft Office Child Process',
			description: 'Office spawned a script interpreter.'
		});
		expect(d.highlighted.map((h) => h.field)).toEqual([
			'host.name',
			'user.name',
			'process.name',
			'process.command_line',
			'process.parent.name'
		]);
		// Flattened `process.parent` key is read like the nested form.
		expect(fields(d)['process.parent.name']).toEqual(['WINWORD.EXE']);
		expect(d.mitre).toEqual([
			{ tactic: 'Initial Access', techniqueId: 'T1566.001', technique: 'Spearphishing Attachment' }
		]);
		expect(d.outcome).toBe('detected');
	});

	it('reads MITRE from the alert when the rule has none (real Defend alert shape)', () => {
		// As written by Elastic Defend 9.5.5 on a Windows Server host in the lab.
		const d = normalizeAlertDetail(
			hit({
				...common,
				'kibana.alert.original_event.code': 'behavior',
				'kibana.alert.rule.threat': [],
				rule: { name: 'Potential Masquerading as SVCHOST' },
				threat: [
					{
						framework: 'MITRE ATT&CK',
						tactic: { id: 'TA0005', name: 'Defense Evasion' },
						technique: [
							{
								id: 'T1036',
								name: 'Masquerading',
								subtechnique: [{ id: 'T1036.004', name: 'Masquerade Task or Service' }]
							}
						]
					}
				]
			})
		);
		expect(d.mitre).toEqual([
			{
				tactic: 'Defense Evasion',
				techniqueId: 'T1036.004',
				technique: 'Masquerading › Masquerade Task or Service'
			}
		]);
	});
});

describe('workflow semantics', () => {
	it('closing reason only accompanies closed alerts and is not a status', () => {
		const closed = normalizeAlertSummary(
			hit({
				...common,
				'kibana.alert.workflow_status': 'closed',
				'kibana.alert.workflow_reason': 'false_positive'
			})
		);
		expect(closed.status).toBe('closed');
		expect(closed.closingReason).toBe('false_positive');
		const open = normalizeAlertSummary(
			hit({ ...common, 'kibana.alert.workflow_reason': 'false_positive' })
		);
		expect(open.closingReason).toBeUndefined();
	});

	it('missing workflow status is open (Elastic default)', () => {
		const { 'kibana.alert.workflow_status': _, ...rest } = common;
		expect(normalizeAlertSummary(hit(rest)).status).toBe('open');
	});

	it('non-endpoint rules are kind "rule" with unknown outcome', () => {
		const s = normalizeAlertSummary(
			hit({
				...common,
				'kibana.alert.original_event.module': undefined,
				'kibana.alert.rule.name': 'Brute force'
			})
		);
		expect(s.kind).toBe('rule');
		expect(s.outcome).toBe('unknown');
		expect(s.title).toBe('Brute force');
	});
});

describe('missing data', () => {
	it('omits missing fields instead of inventing values', () => {
		const d = normalizeAlertDetail(
			hit({ ...common, 'kibana.alert.original_event.code': 'malicious_file', user: undefined })
		);
		// Only host.name is present; nothing else is invented.
		expect(fields(d)).toEqual({ 'host.name': ['ACME-WS-001'] });
		expect(d.defendRule).toBeUndefined();
		expect(d.mitre).toEqual([]);
	});
});

describe('Kibana flyout fields', () => {
	it('uses the rule name override as title, like Kibana', () => {
		const s = normalizeAlertSummary(
			hit({
				...common,
				'kibana.alert.rule.name': 'Malware Prevention Alert',
				'kibana.alert.original_event.code': 'malicious_file',
				message: 'Malware Prevention Alert'
			})
		);
		expect(s.title).toBe('Malware Prevention Alert');
	});

	it('malware highlighted fields carry file, hash and quarantine', () => {
		const d = normalizeAlertDetail(
			hit({
				...common,
				'kibana.alert.original_event.code': 'malicious_file',
				file: { name: 'a.exe', hash: { sha256: 'f'.repeat(64) }, Ext: { quarantine_result: true } }
			})
		);
		expect(d.highlighted).toEqual([
			{ field: 'host.name', values: ['ACME-WS-001'] },
			{ field: 'user.name', values: ['jdoe'] },
			{ field: 'file.name', values: ['a.exe'] },
			{ field: 'file.hash.sha256', values: ['f'.repeat(64)] },
			{ field: 'file.Ext.quarantine_result', values: ['true'] }
		]);
	});

	it('counts assignees without exposing their ids', () => {
		const d = normalizeAlertDetail(
			hit({ ...common, 'kibana.alert.workflow_assignee_ids': ['u_1', 'u_2'] })
		);
		expect(d.assignees).toBe(2);
		expect(JSON.stringify(d)).not.toContain('u_1');
	});

	it('keeps the source detection rule uuid even when the name is overridden', () => {
		const d = normalizeAlertDetail(
			hit({
				...common,
				'kibana.alert.rule.uuid': 'rule-uuid-1',
				'kibana.alert.rule.description': 'x'
			})
		);
		expect(d.detectionRule).toEqual({ uuid: 'rule-uuid-1', description: 'x' });
	});

	it('requests exactly the fields it reads (allowlist covers all highlighted fields)', () => {
		for (const f of ['file.hash.sha256', 'Ransomware.files.path', 'Target.process.executable']) {
			expect(ALERT_SOURCE_FIELDS).toContain(f);
		}
		expect(ALERT_SOURCE_FIELDS).not.toContain('kibana.alert.rule.parameters');
		expect(new Set(ALERT_SOURCE_FIELDS).size).toBe(ALERT_SOURCE_FIELDS.length);
	});

	it('memory-signature alerts name the signature from process.Ext.malware_signature', () => {
		const d = normalizeAlertDetail(
			hit({
				...common,
				'kibana.alert.rule.name': 'Memory Threat Prevention Alert: Windows.Trojan.CobaltStrike',
				'kibana.alert.original_event.code': 'memory_signature',
				process: {
					name: 'powershell.exe',
					Ext: { malware_signature: { all_names: 'Windows.Trojan.CobaltStrike' } }
				}
			})
		);
		expect(d.title).toBe('Windows.Trojan.CobaltStrike');
		expect(d.defendRule?.name).toBe('Windows.Trojan.CobaltStrike');
		expect(fields(d)['process.Ext.malware_signature.all_names']).toEqual([
			'Windows.Trojan.CobaltStrike'
		]);
	});
});
