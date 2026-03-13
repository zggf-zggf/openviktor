import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { EmptyState } from "../components/ui/empty-state";
import { getRuns } from "../lib/api";
import { formatCost, formatDuration, formatTokens, statusColor } from "../lib/utils";

const STATUSES = ["", "QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"];
const TRIGGERS = ["", "MENTION", "DM", "CRON", "HEARTBEAT", "DISCOVERY", "MANUAL"];

export function RunsPage() {
	const navigate = useNavigate();
	const [page, setPage] = useState(1);
	const [status, setStatus] = useState("");
	const [triggerType, setTriggerType] = useState("");

	const { data, isLoading } = useQuery({
		queryKey: ["runs", page, status, triggerType],
		queryFn: () => getRuns({ page, limit: 25, status, triggerType }),
	});

	const totalPages = data ? Math.ceil(data.total / data.limit) : 0;

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold text-slate-900">Agent Runs</h1>

			<div className="flex flex-wrap gap-3">
				<select
					value={status}
					onChange={(e) => {
						setStatus(e.target.value);
						setPage(1);
					}}
					className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
				>
					<option value="">All statuses</option>
					{STATUSES.filter(Boolean).map((s) => (
						<option key={s} value={s}>
							{s}
						</option>
					))}
				</select>
				<select
					value={triggerType}
					onChange={(e) => {
						setTriggerType(e.target.value);
						setPage(1);
					}}
					className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
				>
					<option value="">All triggers</option>
					{TRIGGERS.filter(Boolean).map((t) => (
						<option key={t} value={t}>
							{t}
						</option>
					))}
				</select>
				{data && (
					<span className="flex items-center text-sm text-slate-400">{data.total} runs total</span>
				)}
			</div>

			<div className="rounded-xl border border-slate-200 bg-white shadow-sm">
				{isLoading ? (
					<div className="space-y-3 p-5">
						{["r1", "r2", "r3", "r4", "r5"].map((key) => (
							<div key={key} className="h-10 animate-pulse rounded bg-slate-100" />
						))}
					</div>
				) : !data || data.data.length === 0 ? (
					<EmptyState message="No runs match the current filters" />
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
									<th className="px-5 py-3">Status</th>
									<th className="px-3 py-3">Trigger</th>
									<th className="px-3 py-3">Model</th>
									<th className="px-3 py-3">User</th>
									<th className="px-3 py-3 text-right">Tokens</th>
									<th className="px-3 py-3 text-right">Cost</th>
									<th className="px-3 py-3 text-right">Duration</th>
									<th className="px-3 py-3 text-right">Created</th>
								</tr>
							</thead>
							<tbody>
								{data.data.map((run) => (
									<tr
										key={run.id}
										className="cursor-pointer border-b border-slate-50 transition-colors hover:bg-slate-50"
										onClick={() => navigate(`/runs/${run.id}`)}
										onKeyDown={(e) => e.key === "Enter" && navigate(`/runs/${run.id}`)}
									>
										<td className="px-5 py-3">
											<Badge className={statusColor(run.status)}>{run.status}</Badge>
										</td>
										<td className="px-3 py-3 text-slate-600">{run.triggerType}</td>
										<td className="px-3 py-3 font-mono text-xs text-slate-600">{run.model}</td>
										<td className="px-3 py-3 text-slate-600">{run.triggeredByName ?? "-"}</td>
										<td className="px-3 py-3 text-right font-mono text-xs text-slate-600">
											{formatTokens(run.inputTokens + run.outputTokens)}
										</td>
										<td className="px-3 py-3 text-right text-slate-600">
											{formatCost(run.costCents)}
										</td>
										<td className="px-3 py-3 text-right text-slate-600">
											{formatDuration(run.durationMs)}
										</td>
										<td className="px-3 py-3 text-right text-slate-400">
											{format(new Date(run.createdAt), "MMM d, HH:mm")}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>

			{totalPages > 1 && (
				<div className="flex items-center justify-center gap-2">
					<button
						type="button"
						disabled={page <= 1}
						onClick={() => setPage((p) => p - 1)}
						className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-40"
					>
						Previous
					</button>
					<span className="text-sm text-slate-500">
						Page {page} of {totalPages}
					</span>
					<button
						type="button"
						disabled={page >= totalPages}
						onClick={() => setPage((p) => p + 1)}
						className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-40"
					>
						Next
					</button>
				</div>
			)}
		</div>
	);
}
