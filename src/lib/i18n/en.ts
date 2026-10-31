/**
 * English UI strings, the reference dictionary: every other language has
 * exactly this shape (see `Messages`). Strings with numbers or names are
 * functions, so each language can order words and form plurals its own way.
 * Text that comes from Elastic (rule names, reasons, agent messages, field
 * names) is shown as it is.
 */
const plural = (n: number, one: string, other: string) => (n === 1 ? one : other);

export const en = {
	app: { name: 'Security Portal' },
	nav: {
		overview: 'Overview',
		detections: 'Detections',
		agents: 'Agents',
		openMenu: 'Open menu',
		closeMenu: 'Close menu',
		loading: 'Loading'
	},
	theme: {
		label: (name: string) => `Theme: ${name}`,
		system: 'system',
		light: 'light',
		dark: 'dark'
	},
	language: { label: 'Language' },
	auth: {
		signIn: 'Sign in',
		signingIn: 'Signing in…',
		signOut: 'Sign out',
		username: 'Username',
		password: 'Password',
		invalid: 'Invalid username or password.',
		tooMany: 'Too many login attempts. Please wait a minute and try again.',
		crossSite: 'Cross-site form submissions are forbidden'
	},
	errors: {
		generic: 'Something went wrong.',
		notFound: 'Not found',
		agentNotFound: 'Agent not found',
		internal: 'Internal error',
		unavailable: 'The security data service is currently unavailable. Please try again shortly.',
		backToOverview: 'Back to overview',
		backToAgents: 'Back to agents',
		backToDetections: 'Back to detections'
	},
	severity: { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' },
	workflow: { open: 'Open', acknowledged: 'Acknowledged', closed: 'Closed' },
	closingReason: {
		false_positive: 'False positive',
		true_positive: 'True positive',
		benign_positive: 'Benign positive',
		duplicate: 'Duplicate',
		other: 'Other'
	} as Record<string, string>,
	outcome: { prevented: 'Prevented', detected: 'Detected only', unknown: 'Not reported' },
	kind: {
		malware: 'Malicious file',
		memory: 'Memory threat',
		ransomware: 'Ransomware',
		behavior: 'Malicious behavior',
		rule: 'Detection rule'
	},
	fleet: {
		healthy: 'Healthy',
		unhealthy: 'Unhealthy',
		orphaned: 'Orphaned',
		updating: 'Updating',
		offline: 'Offline',
		inactive: 'Inactive',
		unenrolled: 'Unenrolled',
		uninstalled: 'Uninstalled'
	},
	/** Fleet groups after a count, as in "3 healthy". */
	fleetCount: {
		healthy: 'healthy',
		unhealthy: 'unhealthy',
		offline: 'offline',
		updating: 'updating'
	},
	policy: {
		success: 'Success',
		warning: 'Warning',
		failure: 'Failure',
		unknown: 'Unknown',
		not_installed: 'Not installed'
	},
	/** Defend policy states after a count, as in "2 failure". */
	policyCount: {
		failure: 'failure',
		warning: 'warning',
		unknown: 'unknown',
		not_installed: 'not installed'
	},
	/** Elastic Agent component states. */
	component: {
		HEALTHY: 'Healthy',
		DEGRADED: 'Degraded',
		FAILED: 'Failed',
		STARTING: 'Starting',
		CONFIGURING: 'Configuring',
		STOPPING: 'Stopping',
		STOPPED: 'Stopped'
	} as Record<string, string>,
	/** Integration rows (see groupIntegrations); product names stay as they are. */
	integration: {
		'System metrics': 'System metrics',
		Logs: 'Logs',
		'Elastic Agent monitoring': 'Elastic Agent monitoring'
	} as Record<string, string>,
	common: {
		na: 'N/A',
		notAvailable: 'Not available',
		yes: 'Yes',
		no: 'No',
		copy: 'Copy',
		copyThing: (what: string) => `Copy ${what}`,
		justNow: 'just now',
		all: 'All',
		selected: (n: number) => `${n} selected`,
		noValues: 'No values',
		search: 'Search',
		searchPlaceholder: 'Search…',
		filterPlaceholder: (label: string) => `Filter ${label.toLowerCase()}…`,
		clear: 'Clear',
		clearFilters: 'Clear filters',
		apply: 'Apply',
		actions: 'Actions',
		rowActions: 'Row actions',
		actionsFor: (what: string) => `Actions for ${what}`,
		close: 'Close',
		loading: 'Loading…'
	},
	range: {
		label: 'Time range',
		today: 'Today',
		thisWeek: 'This week',
		/** Plural unit names, for the quick select and "Last N …". */
		units: {
			m: 'minutes',
			h: 'hours',
			d: 'days',
			w: 'weeks',
			mo: 'months',
			y: 'years'
		},
		lastN: (n: number, unit: 'm' | 'h' | 'd' | 'w' | 'mo' | 'y') => {
			const one = { m: 'minute', h: 'hour', d: 'day', w: 'week', mo: 'month', y: 'year' }[unit];
			return `Last ${n} ${plural(n, one, en.range.units[unit])}`;
		},
		quickSelect: 'Quick select',
		last: 'Last',
		amount: 'Amount',
		unit: 'Unit',
		commonlyUsed: 'Commonly used',
		customRange: 'Custom range',
		fromDate: 'From date',
		toDate: 'To date',
		upTo: (days: number) => `Up to ${days} days.`,
		refreshEvery: 'Refresh every',
		refreshInterval: 'Refresh interval',
		refreshUnit: 'Refresh unit',
		seconds: 'seconds',
		minutes: 'minutes',
		hours: 'hours',
		start: 'Start',
		stop: 'Stop',
		autoOn: (every: string) => `On, every ${every}. Waits while you're reading a detection.`,
		autoOff: (min: number) => `Off. At least ${min} seconds.`,
		refresh: 'Refresh',
		refreshAuto: (every: string) => `Refresh (auto every ${every})`
	},
	pagination: {
		shown: (first: string, last: string, total: string, noun: string) =>
			`${first}–${last} of ${total} ${noun}`,
		none: (noun: string) => `0 ${noun}`,
		rows: 'Rows',
		page: (page: number, pages: number) => `Page ${page} / ${pages}`,
		previous: 'Previous page',
		next: 'Next page',
		detections: 'detections',
		agents: 'agents'
	},
	overview: {
		policyStatus: 'Elastic Defend policy status',
		ofSuccess: (n: number) => `/ ${n} success`,
		first5000: ' (first 5,000 agents)',
		activeDetections: 'Active detections',
		critical: (n: number) => `${n} critical`,
		high: (n: number) => `${n} high`,
		openAck: (open: number, ack: number) => `${open} open · ${ack} ack.`,
		threatsPrevented: 'Threats prevented',
		ofDetections: (n: number) => `of ${n} detections`,
		blocked: (range: string) => `Blocked or quarantined · ${range}`,
		needingAttention: 'Agents needing attention',
		topShown: (n: number) => `Top ${n} shown · view agents`,
		viewAgents: 'View agents',
		host: 'Host',
		agentStatus: 'Agent status',
		lastActivity: 'Last activity',
		defendMessage: (msg: string) => `Elastic Defend: ${msg}`,
		policyResponse: (status: string) => `Elastic Defend policy response: ${status}`,
		notCheckingIn: 'Agent is not checking in',
		lostFleet: 'Agent has lost contact with Fleet Server',
		allHealthy: 'All agents are healthy and every Elastic Defend policy applied successfully.',
		severityLevels: 'Severity levels',
		allStatuses: (range: string) => `All statuses · ${range}`,
		levels: 'Levels',
		count: 'Count',
		bySeverity: 'Detections by severity',
		detections: 'detections',
		recentHigh: 'Recent high-priority detections',
		allDetections: 'All detections',
		noHigh: 'No open critical or high detections in this time range.'
	},
	detections: {
		search: 'Search host, user, rule, file, process or SHA256',
		searchOnHost: 'Search user, rule, file, process or SHA256',
		severity: 'Severity',
		status: 'Status',
		type: 'Type',
		rule: 'Rule',
		time: 'Time',
		detection: 'Detection',
		host: 'Host',
		user: 'User',
		outcome: 'Outcome',
		viewDetails: 'View details',
		viewAgent: 'View agent',
		copyAlertId: 'Copy alert ID',
		noMatch: 'No detections match the filters in this time range.'
	},
	alert: {
		details: 'Alert details',
		notFound: 'This detection was not found.',
		loadFailed: 'Could not load detection details. Please try again.',
		defendRule: 'Elastic Defend rule',
		detectionRule: 'Detection rule',
		nameUnavailable: '(name unavailable)',
		status: 'Status',
		riskScore: 'Risk score',
		assignees: 'Assignees',
		unassigned: 'Unassigned',
		analysts: (n: number) => `${n} SOC ${plural(n, 'analyst', 'analysts')}`,
		outcome: 'Outcome',
		about: 'About',
		defendRuleDescription: 'Elastic Defend rule description',
		ruleDescription: 'Rule description',
		reason: 'Alert reason',
		investigation: 'Investigation',
		highlightedFields: 'Highlighted fields',
		field: 'Field',
		value: 'Value'
	},
	agents: {
		search: 'Search by host name or agent ID',
		status: 'Status',
		tags: 'Tags',
		agentPolicy: 'Agent policy',
		upgradeAvailable: 'Upgrade available',
		version: 'Version',
		showing: (n: string) => `Showing ${n} agents`,
		host: 'Host',
		cpu: 'CPU',
		memory: 'Memory',
		lastActivity: 'Last activity',
		defendTitle: 'Elastic Defend policy response, as in Security → Endpoints',
		openDetections: 'Open detections',
		isolatedTitle: 'Network isolated by Elastic Defend',
		isolated: 'Isolated',
		revision: (n: number) => `rev. ${n}`,
		noMatch: 'No agents match the current filters.'
	},
	agent: {
		viewAll: 'View all agents',
		agentPolicy: 'Agent policy',
		agentVersion: 'Agent version',
		agentStatus: 'Agent status',
		lastActivity: 'Last activity',
		openDetections: 'Open detections',
		openDetectionsTitle: 'Open detections from the last year',
		detailsTab: 'Agent details',
		detectionsTab: 'Detections',
		overview: 'Overview',
		cpu: 'CPU',
		memory: 'Memory',
		lastCheckinMessage: 'Last checkin message',
		agentId: 'Agent ID',
		hostName: 'Host name',
		logLevel: 'Logging level',
		platform: 'Platform',
		architecture: 'Architecture',
		enrolled: 'Enrolled',
		tags: 'Tags',
		host: 'Host',
		ips: 'IP addresses',
		macs: 'MAC addresses',
		kernel: 'Kernel',
		hostId: 'Host ID',
		integrations: 'Integrations',
		noComponents: 'No component status reported.',
		defendNotInstalled: "Elastic Defend isn't installed on this agent.",
		policySummary: {
			success: 'Policy applied',
			warning: 'Policy applied with warnings',
			failure: 'Policy could not be fully applied',
			unknown: 'No policy response reported',
			not_installed: ''
		},
		policy: 'Policy',
		endpoint: 'Endpoint',
		isolation: 'Isolation',
		isolated: 'Isolated',
		notIsolated: 'Not isolated',
		reported: 'Reported',
		lastReportOffline: ' · last report, agent offline'
	}
};

export type Messages = typeof en;
