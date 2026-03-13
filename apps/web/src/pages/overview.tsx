import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Activity, CheckCircle2, DollarSign, MessageSquare } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { Badge } from "../components/ui/badge";
import { Card, CardHeader } from "../components/ui/card";
import { EmptyState } from "../components/ui/empty-state";
import { StatCard } from "../components/ui/stat-card";
import { getOverview } from "../lib/api";
import { formatCost, formatDuration, statusColor } from "../lib/utils";

export function OverviewPage() {
	const { data, isLoading, error } = useQuery({
		queryKey: ["overview"],
		queryFn: getOverview,
	});

	if (isLoading) {
		return <PageSkeleton />;
	}

	if (error) {
		return (
			<div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
				Failed to load overview: {(error as Error).message}
			</div>
		);
	}

	if (!data) return null;

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold text-slate-900">Overview</h1>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard
					label="Total Runs"
					value={String(data.stats.totalRuns)}
					subValue="all time"
					icon={Activity}
					color="primary"
				/>
				<StatCard
					label="Total Cost (30d)"
					value={formatCost(data.stats.totalCost)}
					icon={DollarSign}
					color="amber"
				/>
				<StatCard
					label="Success Rate"
					value={`${data.stats.successRate}%`}
					icon={CheckCircle2}
					color="emerald"
				/>
				<StatCard
					label="Active Threads"
					value={String(data.stats.activeThreads)}
					icon={MessageSquare}
					color="primary"
				/>
			</div>

			<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
				<Card>
					<CardHeader title="Runs & Cost (30 days)" />
					{data.runsByDay.length > 0 ? (
						<ResponsiveContainer width="100%" height={240}>
							<LineChart data={data.runsByDay}>
								<CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
								<XAxis
									dataKey="date"
									tick={{ fontSize: 11 }}
									tickFormatter={(v: string) => format(new Date(v), "MMM d")}
								/>
								<YAxis yAxisId="left" tick={{ fontSize: 11 }} />
								<YAxis
									yAxisId="right"
									orientation="right"
									tick={{ fontSize: 11 }}
									tickFormatter={(v: number) => formatCost(v)}
								/>
								<Tooltip
									labelFormatter={(v: string) => format(new Date(v), "MMM d, yyyy")}
									formatter={(value: number, name: string) =>
										name === "cost" ? [formatCost(value), "Cost"] : [value, "Runs"]
									}
								/>
								<Line
									yAxisId="left"
									type="monotone"
									dataKey="runs"
									stroke="#6366f1"
									strokeWidth={2}
									dot={false}
								/>
								<Line
									yAxisId="right"
									type="monotone"
									dataKey="cost"
									stroke="#f59e0b"
									strokeWidth={2}
									dot={false}
								/>
							</LineChart>
						</ResponsiveContainer>
					) : (
						<EmptyState message="No data for the last 30 days" />
					)}
				</Card>

				<Card>
					<CardHeader title="Runs by Trigger" />
					{data.runsByTrigger.length > 0 ? (
						<ResponsiveContainer width="100%" height={240}>
							<BarChart data={data.runsByTrigger}>
								<CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
								<XAxis dataKey="trigger" tick={{ fontSize: 11 }} />
								<YAxis tick={{ fontSize: 11 }} />
								<Tooltip />
								<Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
							</BarChart>
						</ResponsiveContainer>
					) : (
						<EmptyState message="No runs recorded yet" />
					)}
				</Card>
			</div>

			<Card>
				<CardHeader title="Recent Agent Runs" />
				<RecentRunsTable runs={data.recentRuns} />
			</Card>
		</div>
	);
}

function RecentRunsTable({
	runs,
}: {
	runs: NonNullable<
		ReturnType<typeof useQuery<Awaited<ReturnType<typeof getOverview>>>>["data"]
	>["recentRuns"];
}) {
	const navigate = useNavigate();

	if (runs.length === 0) {
		return <EmptyState message="No agent runs yet" />;
	}

	return (
		<div className="overflow-x-auto">
			<table className="w-full text-sm">
				<thead>
					<tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
						<th className="pb-2 pr-4">Status</th>
						<th className="pb-2 pr-4">Trigger</th>
						<th className="pb-2 pr-4">Model</th>
						<th className="pb-2 pr-4 text-right">Cost</th>
						<th className="pb-2 pr-4 text-right">Duration</th>
						<th className="pb-2 text-right">Created</th>
					</tr>
				</thead>
				<tbody>
					{runs.map((run) => (
						<tr
							key={run.id}
							className="cursor-pointer border-b border-slate-50 transition-colors hover:bg-slate-50"
							onClick={() => navigate(`/runs/${run.id}`)}
							onKeyDown={(e) => e.key === "Enter" && navigate(`/runs/${run.id}`)}
						>
							<td className="py-2.5 pr-4">
								<Badge className={statusColor(run.status)}>{run.status}</Badge>
							</td>
							<td className="py-2.5 pr-4 text-slate-600">{run.triggerType}</td>
							<td className="py-2.5 pr-4 font-mono text-xs text-slate-600">{run.model}</td>
							<td className="py-2.5 pr-4 text-right text-slate-600">{formatCost(run.costCents)}</td>
							<td className="py-2.5 pr-4 text-right text-slate-600">
								{formatDuration(run.durationMs)}
							</td>
							<td className="py-2.5 text-right text-slate-400">
								{format(new Date(run.createdAt), "MMM d, HH:mm")}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function PageSkeleton() {
	return (
		<div className="space-y-6">
			<div className="h-8 w-32 animate-pulse rounded bg-slate-200" />
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{["s1", "s2", "s3", "s4"].map((key) => (
					<div
						key={key}
						className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white"
					/>
				))}
			</div>
			<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
				{["c1", "c2"].map((key) => (
					<div
						key={key}
						className="h-72 animate-pulse rounded-xl border border-slate-200 bg-white"
					/>
				))}
			</div>
		</div>
	);
}
