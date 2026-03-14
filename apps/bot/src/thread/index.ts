export { isValidTransition, phaseName, transitionPhase } from "./lifecycle.js";
export {
	type ConcurrencyLimiter,
	InMemoryConcurrencyLimiter,
	RedisConcurrencyLimiter,
	createConcurrencyLimiter,
} from "./concurrency.js";
export { ThreadLock } from "./lock.js";
export { StaleThreadDetector } from "./stale.js";
export {
	generateSlackThreadPath,
	generateCronThreadPath,
	generateSpawnPath,
	isChildPath,
} from "./paths.js";
export { createThreadSpawner, type ThreadSpawnerConfig } from "./spawner.js";

export interface ActiveThreadInfo {
	path: string;
	title: string | null;
	status: string;
}

export async function fetchActiveThreads(
	prisma: Pick<import("@openviktor/db").PrismaClient, "thread">,
	workspaceId: string,
): Promise<ActiveThreadInfo[]> {
	const threads = await prisma.thread.findMany({
		where: { workspaceId, status: "ACTIVE" },
		select: { slackChannel: true, slackThreadTs: true, title: true, status: true },
		take: 20,
	});
	return threads.map((t) => ({
		path: `${t.slackChannel}/${t.slackThreadTs}`,
		title: t.title ?? null,
		status: t.status,
	}));
}
