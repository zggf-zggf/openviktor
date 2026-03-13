import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState } from "react";
import { Badge } from "../components/ui/badge";
import { EmptyState } from "../components/ui/empty-state";
import { getThreads } from "../lib/api";
import { threadStatusColor } from "../lib/utils";

const STATUSES = ["", "ACTIVE", "WAITING", "COMPLETED", "STALE"];

export function ThreadsPage() {
	const [page, setPage] = useState(1);
	const [status, setStatus] = useState("");

	const { data, isLoading } = useQuery({
		queryKey: ["threads", page, status],
		queryFn: () => getThreads({ page, limit: 25, status }),
	});

	const totalPages = data ? Math.ceil(data.total / data.limit) : 0;

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold text-slate-900">Threads</h1>

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
				{data && (
					<span className="flex items-center text-sm text-slate-400">
						{data.total} threads total
					</span>
				)}
			</div>

			<div className="rounded-xl border border-slate-200 bg-white shadow-sm">
				{isLoading ? (
					<div className="space-y-3 p-5">
						{["t1", "t2", "t3", "t4", "t5"].map((key) => (
							<div key={key} className="h-10 animate-pulse rounded bg-slate-100" />
						))}
					</div>
				) : !data || data.data.length === 0 ? (
					<EmptyState message="No threads found" />
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
									<th className="px-5 py-3">Status</th>
									<th className="px-3 py-3">Channel</th>
									<th className="px-3 py-3">Thread TS</th>
									<th className="px-3 py-3 text-right">Phase</th>
									<th className="px-3 py-3 text-right">Runs</th>
									<th className="px-3 py-3 text-right">Created</th>
									<th className="px-3 py-3 text-right">Updated</th>
								</tr>
							</thead>
							<tbody>
								{data.data.map((thread) => (
									<tr key={thread.id} className="border-b border-slate-50">
										<td className="px-5 py-3">
											<Badge className={threadStatusColor(thread.status)}>{thread.status}</Badge>
										</td>
										<td className="px-3 py-3 font-mono text-xs text-slate-600">
											#{thread.slackChannel}
										</td>
										<td className="px-3 py-3 font-mono text-xs text-slate-400">
											{thread.slackThreadTs}
										</td>
										<td className="px-3 py-3 text-right text-slate-600">{thread.phase}</td>
										<td className="px-3 py-3 text-right text-slate-600">{thread.runCount}</td>
										<td className="px-3 py-3 text-right text-slate-400">
											{format(new Date(thread.createdAt), "MMM d, HH:mm")}
										</td>
										<td className="px-3 py-3 text-right text-slate-400">
											{format(new Date(thread.updatedAt), "MMM d, HH:mm")}
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
