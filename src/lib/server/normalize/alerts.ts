import type {
	AlertDetail,
	AlertKind,
	AlertOutcome,
	AlertSummary,
	HighlightedField,
	Severity,
	WorkflowStatus
} from '#lib/contract.ts';
import { SEVERITIES, WORKFLOW_STATUSES } from '#lib/contract.ts';
import {
	bool,
	field,
	num,
	str,
	strList,
	type RawAlertHit,
	type RawAlertSource
} from '../elastic/raw';

/**
 * Highlighted fields per detection type, modelled on Kibana's alert flyout:
 * common host/user fields first, then the fields that matter for this kind of
 * detection. Only fields from ALERT_SOURCE_FIELDS can appear; empty ones are
 * omitted.
 */
const HIGHLIGHTED_BY_KIND: Record<AlertKind, string[]> = {
	malware: [
		'file.name',
		'file.path',
		'file.hash.sha256',
		'file.Ext.quarantine_result',
		'file.Ext.quarantine_path',
		'file.Ext.malware_classification.score',
		'process.name',
		'process.executable'
	],
	memory: [
		'Memory_protection.feature',
		'Memory_protection.self_injection',
		'Memory_protection.cross_session',
		'Memory_protection.parent_to_child',
		'process.Ext.malware_signature.all_names',
		'process.name',
		'process.executable',
		'process.command_line',
		'process.parent.name',
		'Target.process.name',
		'Target.process.executable',
		'Target.process.Ext.memory_region.region_protection',
		'Target.process.Ext.memory_region.allocation_type',
		'Target.process.thread.Ext.start_address_module'
	],
	ransomware: [
		'Ransomware.feature',
		'Ransomware.files.path',
		'Ransomware.files.operation',
		'Ransomware.files.metrics',
		'process.name',
		'process.executable',
		'process.hash.sha256',
		'process.parent.name'
	],
	behavior: [
		'process.name',
		'process.executable',
		'process.command_line',
		'process.parent.name',
		'process.parent.command_line'
	],
	rule: [
		'source.ip',
		'destination.ip',
		'process.name',
		'process.executable',
		'file.name',
		'file.path'
	]
};

const COMMON_HIGHLIGHTED = ['host.name', 'user.name'];

/** Fields the summary, scope checks and flyout header read directly. */
const BASE_FIELDS = [
	'@timestamp',
	'message',
	'kibana.space_ids',
	'kibana.alert.uuid',
	'kibana.alert.severity',
	'kibana.alert.risk_score',
	'kibana.alert.workflow_status',
	'kibana.alert.workflow_reason',
	'kibana.alert.workflow_assignee_ids',
	'kibana.alert.reason',
	'kibana.alert.rule.name',
	'kibana.alert.rule.uuid',
	'kibana.alert.rule.description',
	'kibana.alert.rule.threat',
	'kibana.alert.original_event.code',
	'kibana.alert.original_event.action',
	'kibana.alert.original_event.type',
	'kibana.alert.original_event.module',
	'data_stream.namespace',
	'event.code',
	'event.action',
	'event.type',
	'event.module',
	'agent.id',
	'host.name',
	'host.hostname',
	'user.name',
	'rule.name',
	'rule.description',
	'threat',
	'process.name',
	'file.name',
	'file.Ext.quarantine_result'
];

/**
 * `_source` allowlist requested from Elasticsearch: the base fields plus every
 * highlighted field. Only these fields leave the cluster.
 */
export const ALERT_SOURCE_FIELDS: readonly string[] = [
	...new Set([...BASE_FIELDS, ...COMMON_HIGHLIGHTED, ...Object.values(HIGHLIGHTED_BY_KIND).flat()])
];

/**
 * Elastic Defend `event.code` -> portal detection family. Codes not listed
 * (and alerts from non-endpoint rules) fall back to `rule`.
 */
const KIND_BY_EVENT_CODE: Record<string, AlertKind> = {
	malicious_file: 'malware',
	memory_signature: 'memory',
	shellcode_thread: 'memory',
	behavior: 'behavior',
	ransomware: 'ransomware'
};

export const EVENT_CODES_BY_KIND: Record<Exclude<AlertKind, 'rule'>, string[]> = {
	malware: ['malicious_file'],
	memory: ['memory_signature', 'shellcode_thread'],
	behavior: ['behavior'],
	ransomware: ['ransomware']
};

function eventCode(src: RawAlertSource): string | undefined {
	return str(src, 'kibana.alert.original_event.code') ?? str(src, 'event.code');
}

function isEndpointAlert(src: RawAlertSource): boolean {
	return (
		(str(src, 'kibana.alert.original_event.module') ?? str(src, 'event.module')) === 'endpoint'
	);
}

export function alertKind(src: RawAlertSource): AlertKind {
	if (!isEndpointAlert(src)) return 'rule';
	const code = eventCode(src);
	return (code && KIND_BY_EVENT_CODE[code]) || 'rule';
}

/**
 * Prevention vs detection, only from signals Elastic Defend sets explicitly:
 * `event.type: denied`, `event.action: rule_prevention|rule_detection`, file
 * quarantine, and the Defend alert message. Anything else is `unknown`.
 */
export function alertOutcome(src: RawAlertSource): AlertOutcome {
	if (!isEndpointAlert(src)) return 'unknown';
	const types = [
		...strList(src, 'kibana.alert.original_event.type'),
		...strList(src, 'event.type')
	];
	const action = str(src, 'kibana.alert.original_event.action') ?? str(src, 'event.action');
	const message = str(src, 'message') ?? '';
	if (
		types.includes('denied') ||
		action === 'rule_prevention' ||
		bool(src, 'file.Ext.quarantine_result') === true
	) {
		return 'prevented';
	}
	if (/prevention alert/i.test(message)) return 'prevented';
	if (
		types.includes('allowed') ||
		action === 'rule_detection' ||
		/detection alert/i.test(message)
	) {
		return 'detected';
	}
	return 'unknown';
}

function severity(src: RawAlertSource): Severity {
	const s = str(src, 'kibana.alert.severity') as Severity | undefined;
	return s && SEVERITIES.includes(s) ? s : 'low';
}

function workflowStatus(src: RawAlertSource): WorkflowStatus {
	const s = str(src, 'kibana.alert.workflow_status') as WorkflowStatus | undefined;
	// Elastic treats a missing workflow_status as open.
	return s && WORKFLOW_STATUSES.includes(s) ? s : 'open';
}

/**
 * Table title: the most specific detection name. For Defend behavior and
 * memory-signature alerts that is the Defend rule (`rule.name`), which Kibana
 * only shows inside the overridden rule name. Otherwise the Kibana rule name
 * (for Defend alerts already overridden with the Defend message).
 */
function title(src: RawAlertSource, kind: AlertKind, ruleName: string): string {
	if (kind === 'behavior' || kind === 'memory') {
		const defend = defendRuleName(src);
		if (defend) return defend;
	}
	if (/^Endpoint Security\b/.test(ruleName)) return str(src, 'message') ?? ruleName;
	return ruleName;
}

function subject(src: RawAlertSource, kind: AlertKind): string | undefined {
	switch (kind) {
		case 'malware':
			return str(src, 'file.name') ?? str(src, 'process.name');
		case 'memory':
			return str(src, 'process.name') ?? str(src, 'Target.process.name');
		default:
			return str(src, 'process.name') ?? str(src, 'file.name');
	}
}

export function normalizeAlertSummary(hit: RawAlertHit): AlertSummary {
	const src = hit._source;
	const kind = alertKind(src);
	const ruleName = str(src, 'kibana.alert.rule.name') ?? 'Unknown rule';
	const status = workflowStatus(src);
	return {
		id: str(src, 'kibana.alert.uuid') ?? hit._id,
		timestamp: str(src, '@timestamp') ?? '',
		title: title(src, kind, ruleName),
		ruleName,
		kind,
		severity: severity(src),
		riskScore: num(src, 'kibana.alert.risk_score'),
		status,
		closingReason: status === 'closed' ? str(src, 'kibana.alert.workflow_reason') : undefined,
		outcome: alertOutcome(src),
		hostname: str(src, 'host.name') ?? str(src, 'host.hostname'),
		agentId: str(src, 'agent.id'),
		userName: str(src, 'user.name'),
		subject: subject(src, kind)
	};
}

type Technique = { id?: string; name?: string };
type ThreatEntry = {
	tactic?: { name?: string };
	technique?: (Technique & { subtechnique?: Technique[] })[];
};

const threatList = (v: unknown): ThreatEntry[] =>
	Array.isArray(v) ? v : v && typeof v === 'object' ? [v as ThreatEntry] : [];

/**
 * MITRE ATT&CK from the detection rule, else from the alert itself. Real Elastic
 * Defend alerts carry it in `threat`, while the Endpoint Security rule's own
 * `kibana.alert.rule.threat` is an empty list. Subtechniques are the most
 * specific mapping, shown as "Technique › Subtechnique".
 */
function mitre(src: RawAlertSource): AlertDetail['mitre'] {
	const fromRule = threatList(field(src, 'kibana.alert.rule.threat'));
	const entries = fromRule.length ? fromRule : threatList(field(src, 'threat'));
	const out: AlertDetail['mitre'] = [];
	for (const t of entries) {
		const techniques = Array.isArray(t?.technique) ? t.technique : [];
		if (techniques.length === 0 && t?.tactic?.name) out.push({ tactic: t.tactic.name });
		for (const tech of techniques) {
			const subs = Array.isArray(tech?.subtechnique) ? tech.subtechnique : [];
			if (subs.length === 0) {
				out.push({ tactic: t.tactic?.name, techniqueId: tech?.id, technique: tech?.name });
			}
			for (const sub of subs) {
				out.push({
					tactic: t.tactic?.name,
					techniqueId: sub?.id ?? tech?.id,
					technique: [tech?.name, sub?.name].filter(Boolean).join(' › ') || undefined
				});
			}
		}
	}
	return out;
}

function values(src: RawAlertSource, path: string): string[] {
	const v = field(src, path);
	const list = Array.isArray(v) ? v : [v];
	return list
		.filter((x) => x !== undefined && x !== null && x !== '')
		.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x)))
		.slice(0, 50);
}

function highlightedFields(src: RawAlertSource, kind: AlertKind): HighlightedField[] {
	return [...COMMON_HIGHLIGHTED, ...HIGHLIGHTED_BY_KIND[kind]]
		.map((f) => ({ field: f, values: values(src, f) }))
		.filter((h) => h.values.length > 0);
}

/**
 * The Defend rule or signature behind an endpoint alert: behavior rules carry
 * `rule.name`; memory-signature alerts carry the matched signature in
 * `process.Ext.malware_signature.all_names` (as in Kibana's EndpointDocGenerator).
 */
function defendRuleName(src: RawAlertSource): string | undefined {
	if (!isEndpointAlert(src)) return undefined;
	return str(src, 'rule.name') ?? str(src, 'process.Ext.malware_signature.all_names');
}

function defendRule(src: RawAlertSource): AlertDetail['defendRule'] {
	const name = defendRuleName(src);
	return name ? { name, description: str(src, 'rule.description') } : undefined;
}

export function normalizeAlertDetail(hit: RawAlertHit): AlertDetail {
	const src = hit._source;
	const summary = normalizeAlertSummary(hit);
	const uuid = str(src, 'kibana.alert.rule.uuid');
	const description = str(src, 'kibana.alert.rule.description');
	return {
		...summary,
		detectionRule: {
			...(uuid && { uuid }),
			...(description && { description })
		},
		defendRule: defendRule(src),
		assignees: strList(src, 'kibana.alert.workflow_assignee_ids').length,
		highlighted: highlightedFields(src, summary.kind),
		reason: str(src, 'kibana.alert.reason'),
		mitre: mitre(src)
	};
}
