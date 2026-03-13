import { CronExpressionParser } from "cron-parser";

export function calculateNextRun(schedule: string, from: Date = new Date()): Date {
	const expr = CronExpressionParser.parse(schedule, { currentDate: from });
	return expr.next().toDate();
}

export function isValidCronExpression(schedule: string): boolean {
	try {
		CronExpressionParser.parse(schedule);
		return true;
	} catch {
		return false;
	}
}

export function estimateRunsPerDay(schedule: string): number {
	const now = new Date();
	const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
	const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

	const expr = CronExpressionParser.parse(schedule, { currentDate: start });
	let count = 0;
	try {
		while (expr.hasNext()) {
			const next = expr.next().toDate();
			if (next >= end) break;
			count++;
		}
	} catch {
		// Iterator exhausted
	}
	return count;
}
