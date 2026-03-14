import type { PipedreamClient } from "@openviktor/integrations";
import type { Logger } from "@openviktor/shared";
import type { IntegrationSyncHandler } from "@openviktor/tools";

interface PendingConnection {
	workspaceId: string;
	appSlug: string;
	startedAt: number;
}

export class IntegrationWatcher {
	private pending = new Map<string, PendingConnection>();
	private interval: ReturnType<typeof setInterval> | null = null;

	constructor(
		private pdClient: PipedreamClient,
		private syncHandler: IntegrationSyncHandler,
		private onSync: () => void,
		private logger: Logger,
		private pollIntervalMs = 5_000,
		private timeoutMs = 10 * 60 * 1000,
	) {}

	watch(workspaceId: string, appSlug: string): void {
		const key = `${workspaceId}:${appSlug}`;
		this.pending.set(key, { workspaceId, appSlug, startedAt: Date.now() });
		this.logger.info({ workspaceId, appSlug }, "Watching for new connection");
		this.ensurePolling();
	}

	stop(): void {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
	}

	private ensurePolling(): void {
		if (this.interval) return;
		this.interval = setInterval(() => this.poll(), this.pollIntervalMs);
	}

	private async poll(): Promise<void> {
		if (this.pending.size === 0) {
			this.stop();
			return;
		}

		for (const [key, pending] of this.pending) {
			if (Date.now() - pending.startedAt > this.timeoutMs) {
				this.pending.delete(key);
				this.logger.info({ key }, "Connection watch timed out");
				continue;
			}

			try {
				const externalUserId = `workspace_${pending.workspaceId}`;
				const accounts = await this.pdClient.listAccounts(externalUserId, pending.appSlug);
				const healthy = accounts.filter((a) => a.healthy && !a.dead);

				if (healthy.length > 0) {
					this.logger.info(
						{ appSlug: pending.appSlug, accounts: healthy.length },
						"New connection detected",
					);
					this.pending.delete(key);

					const result = await this.syncHandler.syncWorkspace(pending.workspaceId);
					if (result.added.length > 0) {
						this.logger.info({ added: result.added }, "Auto-synced integration tools");
						this.onSync();
					}
				}
			} catch (err) {
				this.logger.warn({ err, key }, "Connection poll check failed");
			}
		}
	}
}
