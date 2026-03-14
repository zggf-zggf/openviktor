export { isValidTransition, phaseName, transitionPhase } from "./lifecycle.js";
export {
	type ConcurrencyLimiter,
	InMemoryConcurrencyLimiter,
	RedisConcurrencyLimiter,
	createConcurrencyLimiter,
} from "./concurrency.js";
export { ThreadLock } from "./lock.js";
export { StaleThreadDetector } from "./stale.js";

export async function fetchActiveThreads(
	prisma: Pick<import("@openviktor/db").PrismaClient, "thread">,
	workspaceId: string,
): Promise<string[]> {
	const threads = await prisma.thread.findMany({
		where: { workspaceId, status: "ACTIVE" },
		select: { slackChannel: true, slackThreadTs: true },
		take: 20,
	});
	return threads.map((t) => `${t.slackChannel}/${t.slackThreadTs}`);
}
