import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Badge } from "../components/ui/badge";
import { Card, CardHeader } from "../components/ui/card";
import { EmptyState } from "../components/ui/empty-state";
import { getCronJobs, toggleCronJob } from "../lib/api";

export function CronJobsPage() {
	const queryClient = useQueryClient();
	const { data: jobs, isLoading } = useQuery({
		queryKey: ["cron-jobs"],
		queryFn: getCronJobs,
	});

	const toggle = useMutation({
		mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => toggleCronJob(id, enabled),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cron-jobs"] }),
	});

	if (isLoading) {
		return (
			<div className="space-y-6">
				<div className="h-8 w-32 animate-pulse rounded bg-slate-200" />
				<div className="space-y-3">
					{["cj1", "cj2", "cj3"].map((key) => (
						<div
							key={key}
							className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white"
						/>
					))}
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold text-slate-900">Cron Jobs</h1>

			{!jobs || jobs.length === 0 ? (
				<Card>
					<EmptyState message="No cron jobs configured" />
				</Card>
			) : (
				<div className="space-y-3">
					{jobs.map((job) => (
						<Card key={job.id}>
							<div className="flex items-start justify-between gap-4">
								<div className="flex-1">
									<div className="flex items-center gap-2">
										<h3 className="font-semibold text-slate-900">{job.name}</h3>
										<Badge
											className={
												job.enabled
													? "bg-emerald-100 text-emerald-800"
													: "bg-slate-100 text-slate-500"
											}
										>
											{job.enabled ? "Enabled" : "Disabled"}
										</Badge>
										<Badge className="bg-slate-100 text-slate-600">Tier {job.costTier}</Badge>
									</div>
									{job.description && (
										<p className="mt-1 text-sm text-slate-600">{job.description}</p>
									)}
									<div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-400">
										<span>
											Schedule: <span className="font-mono text-slate-600">{job.schedule}</span>
										</span>
										{job.lastRunAt && (
											<span>Last run: {format(new Date(job.lastRunAt), "MMM d, yyyy HH:mm")}</span>
										)}
										{job.nextRunAt && (
											<span>Next run: {format(new Date(job.nextRunAt), "MMM d, yyyy HH:mm")}</span>
										)}
									</div>
									<details className="mt-3">
										<summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700">
											Agent Prompt
										</summary>
										<pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-700">
											{job.agentPrompt}
										</pre>
									</details>
								</div>
								<button
									type="button"
									onClick={() => toggle.mutate({ id: job.id, enabled: !job.enabled })}
									disabled={toggle.isPending}
									className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 ${
										job.enabled ? "bg-primary-600" : "bg-slate-200"
									}`}
								>
									<span
										className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
											job.enabled ? "translate-x-5" : "translate-x-0"
										}`}
									/>
								</button>
							</div>
						</Card>
					))}
				</div>
			)}
		</div>
	);
}
