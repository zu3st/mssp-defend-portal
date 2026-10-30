import type { Messages } from './en.ts';

/**
 * German UI strings. Terms follow Kibana's German translation (de-DE) where
 * Kibana has one, e.g. Fleet's agent states and the alert flyout; where that
 * translation is plainly wrong, the correct German is used instead.
 */
const plural = (n: number, one: string, other: string) => (n === 1 ? one : other);

export const de: Messages = {
	app: { name: 'Sicherheitsportal' },
	nav: {
		overview: 'Überblick',
		detections: 'Erkennungen',
		agents: 'Agenten',
		openMenu: 'Menü öffnen',
		closeMenu: 'Menü schließen',
		loading: 'Wird geladen'
	},
	theme: {
		label: (name: string) => `Design: ${name}`,
		system: 'System',
		light: 'Hell',
		dark: 'Dunkel'
	},
	language: {
		label: 'Sprache',
		system: 'System'
	},
	auth: {
		signIn: 'Anmelden',
		signingIn: 'Anmeldung läuft…',
		signOut: 'Abmelden',
		username: 'Benutzername',
		password: 'Passwort',
		invalid: 'Benutzername oder Passwort ist falsch.',
		tooMany: 'Zu viele Anmeldeversuche. Bitte warten Sie eine Minute und versuchen Sie es erneut.',
		crossSite: 'Formularübermittlungen von anderen Websites sind nicht erlaubt'
	},
	errors: {
		generic: 'Etwas ist schiefgelaufen.',
		notFound: 'Nicht gefunden',
		agentNotFound: 'Agent nicht gefunden',
		internal: 'Interner Fehler',
		unavailable:
			'Der Sicherheitsdatendienst ist derzeit nicht verfügbar. Bitte versuchen Sie es in Kürze erneut.',
		backToOverview: 'Zurück zum Überblick',
		backToAgents: 'Zurück zu den Agenten',
		backToDetections: 'Zurück zu den Erkennungen'
	},
	severity: { critical: 'Kritisch', high: 'Hoch', medium: 'Mittel', low: 'Niedrig' },
	workflow: { open: 'Offen', acknowledged: 'Bestätigt', closed: 'Geschlossen' },
	closingReason: {
		false_positive: 'Falsch positiv',
		true_positive: 'Richtig positiv',
		benign_positive: 'Gutartig positiv',
		duplicate: 'Duplikat',
		other: 'Andere'
	},
	outcome: { prevented: 'Verhindert', detected: 'Nur erkannt', unknown: 'Nicht gemeldet' },
	kind: {
		malware: 'Schädliche Datei',
		memory: 'Speicherbedrohung',
		ransomware: 'Ransomware',
		behavior: 'Bösartiges Verhalten',
		rule: 'Erkennungsregel'
	},
	fleet: {
		healthy: 'Gesund',
		unhealthy: 'Ungesund',
		orphaned: 'Verwaist',
		updating: 'Wird aktualisiert',
		offline: 'Offline',
		inactive: 'Inaktiv',
		unenrolled: 'Nicht angemeldet',
		uninstalled: 'Deinstalliert'
	},
	fleetCount: {
		healthy: 'gesund',
		unhealthy: 'ungesund',
		offline: 'offline',
		updating: 'in Aktualisierung'
	},
	policy: {
		success: 'Erfolg',
		warning: 'Warnung',
		failure: 'Fehler',
		unknown: 'Unbekannt',
		not_installed: 'Nicht installiert'
	},
	policyCount: {
		failure: 'mit Fehler',
		warning: 'mit Warnung',
		unknown: 'unbekannt',
		not_installed: 'nicht installiert'
	},
	component: {
		HEALTHY: 'Gesund',
		DEGRADED: 'Beeinträchtigt',
		FAILED: 'Fehlgeschlagen',
		STARTING: 'Wird gestartet',
		CONFIGURING: 'Wird konfiguriert',
		STOPPING: 'Wird gestoppt',
		STOPPED: 'Gestoppt'
	},
	integration: {
		'System metrics': 'Systemmetriken',
		Logs: 'Logs',
		'Elastic Agent monitoring': 'Elastic Agent-Monitoring'
	},
	common: {
		na: 'k. A.',
		notAvailable: 'Nicht verfügbar',
		yes: 'Ja',
		no: 'Nein',
		copy: 'Kopieren',
		copyThing: (what: string) => `${what} kopieren`,
		justNow: 'gerade eben',
		all: 'Alle',
		selected: (n: number) => `${n} ausgewählt`,
		noValues: 'Keine Werte',
		search: 'Suche',
		searchPlaceholder: 'Suchen…',
		filterPlaceholder: (label: string) => `${label} filtern…`,
		clear: 'Zurücksetzen',
		clearFilters: 'Filter zurücksetzen',
		apply: 'Anwenden',
		actions: 'Aktionen',
		rowActions: 'Zeilenaktionen',
		actionsFor: (what: string) => `Aktionen für ${what}`,
		close: 'Schließen',
		loading: 'Wird geladen…'
	},
	range: {
		label: 'Zeitraum',
		today: 'Heute',
		thisWeek: 'Diese Woche',
		units: {
			m: 'Minuten',
			h: 'Stunden',
			d: 'Tage',
			w: 'Wochen',
			mo: 'Monate',
			y: 'Jahre'
		},
		// "Letzte Stunde", "Letzter Tag", "Letztes Jahr", "Letzte 7 Tage"
		lastN: (n, unit) => {
			const one = {
				m: 'Letzte Minute',
				h: 'Letzte Stunde',
				d: 'Letzter Tag',
				w: 'Letzte Woche',
				mo: 'Letzter Monat',
				y: 'Letztes Jahr'
			}[unit];
			return plural(n, one, `Letzte ${n} ${de.range.units[unit]}`);
		},
		quickSelect: 'Schnellauswahl',
		last: 'Letzte',
		amount: 'Wert',
		unit: 'Zeiteinheit',
		commonlyUsed: 'Häufig verwendet',
		customRange: 'Benutzerdefinierter Zeitraum',
		fromDate: 'Startdatum',
		toDate: 'Enddatum',
		upTo: (days: number) => `Höchstens ${days} Tage.`,
		refreshEvery: 'Aktualisierung alle',
		refreshInterval: 'Aktualisierungsintervall',
		refreshUnit: 'Einheit des Aktualisierungsintervalls',
		seconds: 'Sekunden',
		minutes: 'Minuten',
		hours: 'Stunden',
		start: 'Starten',
		stop: 'Stoppen',
		autoOn: (every: string) => `An, alle ${every}. Pausiert, solange Sie eine Erkennung lesen.`,
		autoOff: (min: number) => `Aus. Mindestens ${min} Sekunden.`,
		refresh: 'Aktualisieren',
		refreshAuto: (every: string) => `Aktualisieren (automatisch alle ${every})`
	},
	pagination: {
		shown: (first: string, last: string, total: string, noun: string) =>
			`${first}–${last} von ${total} ${noun}`,
		none: (noun: string) => `0 ${noun}`,
		rows: 'Zeilen pro Seite',
		page: (page: number, pages: number) => `Seite ${page} von ${pages}`,
		previous: 'Vorherige Seite',
		next: 'Nächste Seite',
		detections: 'Erkennungen',
		agents: 'Agenten'
	},
	overview: {
		policyStatus: 'Elastic Defend-Richtlinienstatus',
		ofSuccess: (n: number) => `/ ${n} erfolgreich`,
		first5000: ' (erste 5.000 Agenten)',
		activeDetections: 'Aktive Erkennungen',
		critical: (n: number) => `${n} kritisch`,
		high: (n: number) => `${n} hoch`,
		openAck: (open: number, ack: number) => `${open} offen · ${ack} best.`,
		threatsPrevented: 'Verhinderte Bedrohungen',
		ofDetections: (n: number) => `von ${n} Erkennungen`,
		blocked: (range: string) =>
			`Von Elastic Defend blockiert oder in Quarantäne verschoben · ${range}`,
		needingAttention: 'Agenten mit Handlungsbedarf',
		topShown: (n: number) => `Top ${n} angezeigt · Agenten anzeigen`,
		viewAgents: 'Agenten anzeigen',
		host: 'Host',
		agentStatus: 'Agentenstatus',
		lastActivity: 'Letzte Aktivität',
		defendMessage: (msg: string) => `Elastic Defend: ${msg}`,
		policyResponse: (status: string) => `Elastic Defend-Richtlinienantwort: ${status}`,
		notCheckingIn: 'Agent meldet sich nicht',
		lostFleet: 'Agent hat den Kontakt zum Fleet Server verloren',
		allHealthy:
			'Alle Agenten sind gesund und jede Elastic Defend-Richtlinie wurde erfolgreich angewendet.',
		severityLevels: 'Schweregrade',
		allStatuses: (range: string) => `Alle Status · ${range}`,
		levels: 'Stufen',
		count: 'Anzahl',
		bySeverity: 'Erkennungen nach Schweregrad',
		detections: 'Erkennungen',
		recentHigh: 'Aktuelle Erkennungen mit hoher Priorität',
		allDetections: 'Alle Erkennungen',
		noHigh: 'Keine offenen kritischen oder hohen Erkennungen in diesem Zeitraum.'
	},
	detections: {
		search: 'Host, Benutzer, Regel, Datei, Prozess oder SHA256 suchen',
		searchOnHost: 'Benutzer, Regel, Datei, Prozess oder SHA256 suchen',
		severity: 'Schweregrad',
		status: 'Status',
		type: 'Typ',
		rule: 'Regel',
		time: 'Zeit',
		detection: 'Erkennung',
		host: 'Host',
		user: 'Benutzer',
		outcome: 'Ergebnis',
		viewDetails: 'Details anzeigen',
		viewAgent: 'Agent anzeigen',
		copyAlertId: 'Alert-ID kopieren',
		noMatch: 'Keine Erkennungen entsprechen den Filtern in diesem Zeitraum.'
	},
	alert: {
		details: 'Alert-Details',
		notFound: 'Diese Erkennung wurde nicht gefunden.',
		loadFailed:
			'Die Details der Erkennung konnten nicht geladen werden. Bitte versuchen Sie es erneut.',
		defendRule: 'Elastic Defend-Regel',
		detectionRule: 'Erkennungsregel',
		nameUnavailable: '(Name nicht verfügbar)',
		status: 'Status',
		riskScore: 'Risiko-Score',
		assignees: 'Zuweisungen',
		unassigned: 'Keine Zuweisungen',
		analysts: (n: number) => `${n} ${plural(n, 'SOC-Analyst', 'SOC-Analysten')}`,
		outcome: 'Ergebnis',
		about: 'Über',
		defendRuleDescription: 'Beschreibung der Elastic Defend-Regel',
		ruleDescription: 'Regelbeschreibung',
		reason: 'Grund für den Alert',
		investigation: 'Untersuchung',
		highlightedFields: 'Hervorgehobene Felder',
		field: 'Feld',
		value: 'Wert'
	},
	agents: {
		search: 'Nach Hostname oder Agenten-ID suchen',
		status: 'Status',
		tags: 'Tags',
		agentPolicy: 'Agent Policy',
		upgradeAvailable: 'Upgrade verfügbar',
		version: 'Version',
		// Short, so Fleet's eight status counts still fit on one line beside it.
		showing: (n: string) => `${n} Agenten`,
		host: 'Host',
		cpu: 'CPU',
		memory: 'Speicher',
		lastActivity: 'Letzte Aktivität',
		defendTitle: 'Elastic Defend-Richtlinienantwort, wie unter Security → Endpoints',
		openDetections: 'Offene Erkennungen',
		isolatedTitle: 'Von Elastic Defend vom Netzwerk isoliert',
		isolated: 'Isoliert',
		revision: (n: number) => `Rev. ${n}`,
		noMatch: 'Keine Agenten entsprechen den aktuellen Filtern.'
	},
	agent: {
		viewAll: 'Alle Agenten anzeigen',
		agentPolicy: 'Agent Policy',
		agentVersion: 'Agentenversion',
		agentStatus: 'Agentenstatus',
		lastActivity: 'Letzte Aktivität',
		openDetections: 'Offene Erkennungen',
		openDetectionsTitle: 'Offene Erkennungen aus dem letzten Jahr',
		detailsTab: 'Agentendetails',
		detectionsTab: 'Erkennungen',
		overview: 'Überblick',
		cpu: 'CPU',
		memory: 'Arbeitsspeicher',
		lastCheckinMessage: 'Letzte Check-in-Nachricht',
		agentId: 'Agenten-ID',
		hostName: 'Hostname',
		logLevel: 'Protokollierungsebene',
		platform: 'Plattform',
		architecture: 'Architektur',
		enrolled: 'Registriert',
		tags: 'Tags',
		host: 'Host',
		ips: 'IP-Adressen',
		macs: 'MAC-Adressen',
		kernel: 'Kernel',
		hostId: 'Host-ID',
		integrations: 'Integrationen',
		noComponents: 'Kein Komponentenstatus gemeldet.',
		defendNotInstalled: 'Elastic Defend ist auf diesem Agenten nicht installiert.',
		policySummary: {
			success: 'Richtlinie angewendet',
			warning: 'Richtlinie mit Warnungen angewendet',
			failure: 'Richtlinie konnte nicht vollständig angewendet werden',
			unknown: 'Keine Richtlinienantwort gemeldet',
			not_installed: ''
		},
		policy: 'Richtlinie',
		endpoint: 'Endpoint',
		isolation: 'Isolation',
		isolated: 'Isoliert',
		notIsolated: 'Nicht isoliert',
		reported: 'Gemeldet',
		lastReportOffline: ' · letzte Meldung, Agent offline'
	}
};
