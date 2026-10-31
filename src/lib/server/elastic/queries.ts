/**
 * Pure builders for Fleet KQL and Elasticsearch query DSL. Each one ANDs in the
 * tenant scope and uses request values only as escaped literals.
 */
import type {
	AgentQuery,
	AgentSortField,
	AlertQuery,
	AlertSortField,
	TimeRange
} from '#lib/contract.ts';
import type { TenantScope } from '../config';
import { EVENT_CODES_BY_KIND, ALERT_SOURCE_FIELDS } from '../normalize/alerts';
import { LIMITS } from '../datasource/types';

// ---------------------------------------------------------------------------
// KQL (Fleet / Endpoint APIs)

/** Quoted KQL literal: wildcards inside quotes are not interpreted. */
export function kqlQuote(v: string): string {
	return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Unquoted KQL value for wildcard search; escapes every KQL special char. */
export function kqlEscapeWildcard(v: string): string {
	return v.replace(/[\\():<>"*{}\s]/g, (c) => `\\${c}`);
}

export function kqlAnyOf(fieldName: string, values: string[]): string {
	return `${fieldName}:(${values.map(kqlQuote).join(' or ')})`;
}

export function agentPolicyKuery(scope: TenantScope): string {
	return kqlAnyOf('policy_id', scope.agentPolicyIds);
}

const VERSION_FIELD = 'local_metadata.elastic.agent.version';

/**
 * The tenant's agents that report a version other than `seen`. Asking for one
 * such agent at a time lists the distinct versions in (versions + 1) requests.
 */
export function unseenVersionKuery(scope: TenantScope, seen: string[]): string {
	const parts = [agentPolicyKuery(scope), `${VERSION_FIELD}:*`];
	if (seen.length) parts.push(`not ${kqlAnyOf(VERSION_FIELD, seen)}`);
	return parts.map((p) => `(${p})`).join(' and ');
}

export function agentKuery(
	scope: TenantScope,
	q: Pick<AgentQuery, 'search' | 'statuses' | 'versions' | 'policyIds' | 'tags'>
): string {
	const parts = [agentPolicyKuery(scope)];
	if (q.policyIds?.length) parts.push(kqlAnyOf('policy_id', q.policyIds));
	if (q.statuses?.length) parts.push(`status:(${q.statuses.join(' or ')})`);
	if (q.versions?.length) parts.push(kqlAnyOf(VERSION_FIELD, q.versions));
	if (q.tags?.length) parts.push(kqlAnyOf('tags', q.tags));
	if (q.search) {
		const s = kqlEscapeWildcard(q.search);
		parts.push(`(local_metadata.host.hostname:*${s}* or local_metadata.elastic.agent.id:*${s}*)`);
	}
	return parts.map((p) => `(${p})`).join(' and ');
}

export const FLEET_SORT_FIELDS: Record<AgentSortField, string> = {
	hostname: 'local_metadata.host.hostname.keyword',
	policy: 'policy_id',
	lastCheckin: 'last_checkin',
	agentVersion: 'local_metadata.elastic.agent.version.keyword',
	enrolledAt: 'enrolled_at'
};

// ---------------------------------------------------------------------------
// Elasticsearch DSL (alerts)

type Clause = Record<string, unknown>;

/**
 * Mandatory tenant filter for every alerts query: the space-specific alias is
 * the index, and in addition the document must carry this space id and one of
 * the tenant's data-stream namespaces.
 */
export function alertScopeFilter(scope: TenantScope): Clause[] {
	return [
		{ term: { 'kibana.space_ids': scope.spaceId } },
		{ terms: { 'data_stream.namespace': scope.namespaces } }
	];
}

function rangeFilter(range: TimeRange): Clause {
	return {
		range: { '@timestamp': { gte: range.from, lte: range.to, format: 'strict_date_optional_time' } }
	};
}

function escapeWildcard(v: string): string {
	return v.replace(/[\\*?]/g, (c) => `\\${c}`);
}

const SEARCH_FIELDS = [
	'host.name',
	'user.name',
	'kibana.alert.rule.name',
	'rule.name',
	'file.name',
	'process.name',
	'file.hash.sha256'
];

function alertFilters(
	scope: TenantScope,
	q: Omit<AlertQuery, 'sort' | 'dir' | 'page' | 'pageSize'>
): Clause[] {
	const f: Clause[] = [...alertScopeFilter(scope), rangeFilter(q.range)];
	if (q.severities?.length) f.push({ terms: { 'kibana.alert.severity': q.severities } });
	if (q.statuses?.length) {
		const should: Clause[] = [{ terms: { 'kibana.alert.workflow_status': q.statuses } }];
		// Elastic treats a missing workflow_status as open.
		if (q.statuses.includes('open'))
			should.push({ bool: { must_not: { exists: { field: 'kibana.alert.workflow_status' } } } });
		f.push({ bool: { should, minimum_should_match: 1 } });
	}
	if (q.ruleIds?.length) f.push({ terms: { 'kibana.alert.rule.uuid': q.ruleIds } });
	if (q.agentId) f.push({ term: { 'agent.id': q.agentId } });
	if (q.hostname) f.push({ term: { 'host.name': { value: q.hostname, case_insensitive: true } } });
	if (q.kinds?.length) {
		const should: Clause[] = [];
		for (const k of q.kinds) {
			if (k === 'rule') {
				should.push({
					bool: { must_not: { term: { 'kibana.alert.original_event.module': 'endpoint' } } }
				});
				should.push({
					bool: {
						filter: [{ term: { 'kibana.alert.original_event.module': 'endpoint' } }],
						must_not: [
							{
								terms: {
									'kibana.alert.original_event.code': Object.values(EVENT_CODES_BY_KIND).flat()
								}
							}
						]
					}
				});
			} else {
				should.push({
					bool: {
						filter: [
							{ term: { 'kibana.alert.original_event.module': 'endpoint' } },
							{ terms: { 'kibana.alert.original_event.code': EVENT_CODES_BY_KIND[k] } }
						]
					}
				});
			}
		}
		f.push({ bool: { should, minimum_should_match: 1 } });
	}
	if (q.search) {
		const v = `*${escapeWildcard(q.search)}*`;
		f.push({
			bool: {
				should: SEARCH_FIELDS.map((fieldName) => ({
					wildcard: { [fieldName]: { value: v, case_insensitive: true } }
				})),
				minimum_should_match: 1
			}
		});
	}
	return f;
}

const ALERT_SORT_FIELDS: Record<AlertSortField, string> = {
	timestamp: '@timestamp',
	// Severity keywords do not sort meaningfully; risk score does.
	severity: 'kibana.alert.risk_score',
	ruleName: 'kibana.alert.rule.name',
	hostname: 'host.name',
	status: 'kibana.alert.workflow_status'
};

export function alertSearchBody(scope: TenantScope, q: AlertQuery) {
	const from = (q.page - 1) * q.pageSize;
	return {
		from,
		size: Math.min(q.pageSize, LIMITS.maxResultWindow - from),
		track_total_hits: LIMITS.maxResultWindow,
		_source: { includes: [...ALERT_SOURCE_FIELDS] },
		query: { bool: { filter: alertFilters(scope, q) } },
		sort: [
			{ [ALERT_SORT_FIELDS[q.sort]]: { order: q.dir, unmapped_type: 'keyword', missing: '_last' } },
			...(q.sort === 'timestamp' ? [] : [{ '@timestamp': { order: 'desc' } }])
		]
	};
}

export function alertByIdBody(scope: TenantScope, alertId: string) {
	return {
		size: 1,
		_source: { includes: [...ALERT_SOURCE_FIELDS] },
		query: {
			bool: { filter: [...alertScopeFilter(scope), { term: { 'kibana.alert.uuid': alertId } }] }
		}
	};
}

const PREVENTED_FILTER: Clause = {
	bool: {
		filter: [{ term: { 'kibana.alert.original_event.module': 'endpoint' } }],
		should: [
			{ term: { 'kibana.alert.original_event.type': 'denied' } },
			{ term: { 'kibana.alert.original_event.action': 'rule_prevention' } },
			{ term: { 'file.Ext.quarantine_result': true } }
		],
		minimum_should_match: 1
	}
};

export function alertAggregatesBody(scope: TenantScope, range: TimeRange) {
	return {
		size: 0,
		track_total_hits: true,
		query: { bool: { filter: [...alertScopeFilter(scope), rangeFilter(range)] } },
		aggs: {
			severity: { terms: { field: 'kibana.alert.severity', size: 10 } },
			status: { terms: { field: 'kibana.alert.workflow_status', size: 10, missing: 'open' } },
			active: {
				filter: { bool: { must_not: { term: { 'kibana.alert.workflow_status': 'closed' } } } },
				aggs: {
					severity: { terms: { field: 'kibana.alert.severity', size: 10 } },
					recent: {
						filter: { terms: { 'kibana.alert.severity': ['high', 'critical'] } },
						aggs: {
							top: {
								top_hits: {
									size: 5,
									sort: [{ '@timestamp': { order: 'desc' } }],
									_source: { includes: [...ALERT_SOURCE_FIELDS] }
								}
							}
						}
					}
				}
			},
			prevented: { filter: PREVENTED_FILTER }
		}
	};
}

export function alertCountsByAgentBody(scope: TenantScope, agentIds: string[]) {
	return {
		size: 0,
		query: {
			bool: {
				filter: [
					...alertScopeFilter(scope),
					{ terms: { 'agent.id': agentIds.slice(0, LIMITS.maxAgentIdsPerQuery) } }
				]
			}
		},
		aggs: {
			agents: {
				terms: { field: 'agent.id', size: Math.min(agentIds.length, LIMITS.maxAgentIdsPerQuery) },
				aggs: {
					status: { terms: { field: 'kibana.alert.workflow_status', size: 5, missing: 'open' } }
				}
			}
		}
	};
}

export function ruleIdsBody(scope: TenantScope, range: TimeRange) {
	return {
		size: 0,
		query: { bool: { filter: [...alertScopeFilter(scope), rangeFilter(range)] } },
		aggs: {
			rules: { terms: { field: 'kibana.alert.rule.uuid', size: 200 } }
		}
	};
}
