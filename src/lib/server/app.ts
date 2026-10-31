import { loadConfig, type AppConfig } from './config';
import type { DataSource } from './datasource/types';
import { ElasticDataSource } from './elastic/source';
import { MockDataSource } from './mock/source';
import { Portal } from './portal';

/** Process-wide singletons. One container = one tenant = one Portal. */
let state: { config: AppConfig; portal: Portal } | undefined;

export function app() {
	if (!state) {
		const config = loadConfig();
		const source: DataSource =
			config.dataSource === 'elastic'
				? new ElasticDataSource(config.elastic!)
				: new MockDataSource();
		state = { config, portal: new Portal(config.tenant, source) };
		console.info(
			JSON.stringify({
				msg: 'portal started',
				tenant: config.tenant.id,
				space: config.tenant.spaceId,
				dataSource: config.dataSource,
				issuer: config.auth.oidc.issuer.href
			})
		);
	}
	return state;
}
