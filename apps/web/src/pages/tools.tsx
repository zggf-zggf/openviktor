import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Wrench, Zap } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "../components/ui/badge";
import { Card, CardHeader } from "../components/ui/card";
import { EmptyState } from "../components/ui/empty-state";
import { StatCard } from "../components/ui/stat-card";
import { getToolsStats } from "../lib/api";
import { formatDuration } from "../lib/utils";

export function ToolsPage() {
	const { data, isLoading } = useQuery({
		queryKey: ["tools-stats"],
		queryFn: getToolsStats,
	});

	if (isLoading) {
		return (
			<div className="space-y-6">
				<div className="h-8 w-32 animate-pulse rounded bg-slate-200" />
				<div className="grid grid-cols-3 gap-4">
					{["ts1", "ts2", "ts3"].map((key) => (
						<div
							key={key}
							className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white"
						/>
					))}
				</div>
			</div>
		);
	}

	if (!data) return null;

	const top10 = data.stats.slice(0, 10);

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold text-slate-900">Tools</h1>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
				<StatCard
					label="Total Calls"
					value={String(data.totalCalls)}
					icon={Wrench}
					color="primary"
				/>
				<StatCard
					label="Success Rate"
					value={`${data.overallSuccessRate}%`}
					icon={CheckCircle2}
					color="emerald"
				/>
				<StatCard label="Unique Tools" value={String(data.stats.length)} icon={Zap} color="amber" />
			</div>

			<Card>
				<CardHeader title="Top 10 Tools by Usage" />
				{top10.length > 0 ? (
					<ResponsiveContainer width="100%" height={280}>
						<BarChart data={top10} layout="vertical">
							<CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
							<XAxis type="number" tick={{ fontSize: 11 }} />
							<YAxis type="category" dataKey="toolName" tick={{ fontSize: 11 }} width={160} />
							<Tooltip />
							<Bar dataKey="totalCalls" fill="#6366f1" radius={[0, 4, 4, 0]} />
						</BarChart>
					</ResponsiveContainer>
				) : (
					<EmptyState message="No tool calls recorded yet" />
				)}
			</Card>

			<Card>
				<CardHeader title="All Tools" />
				{data.stats.length === 0 ? (
					<EmptyState message="No tool usage data" />
				) : (
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
									<th className="pb-2 pr-4">Tool</th>
									<th className="pb-2 pr-4 text-right">Calls</th>
									<th className="pb-2 pr-4 text-right">Success</th>
									<th className="pb-2 pr-4 text-right">Failed</th>
									<th className="pb-2 pr-4 text-right">Avg Duration</th>
									<th className="pb-2 text-right">Success Rate</th>
								</tr>
							</thead>
							<tbody>
								{data.stats.map((tool) => {
									const rate =
										tool.totalCalls > 0
											? Math.round((tool.successCount / tool.totalCalls) * 100)
											: 0;
									return (
										<tr key={tool.toolName} className="border-b border-slate-50">
											<td className="py-2.5 pr-4 font-mono text-xs font-medium text-slate-700">
												{tool.toolName}
											</td>
											<td className="py-2.5 pr-4 text-right text-slate-600">{tool.totalCalls}</td>
											<td className="py-2.5 pr-4 text-right text-emerald-600">
												{tool.successCount}
											</td>
											<td className="py-2.5 pr-4 text-right text-red-600">{tool.failedCount}</td>
											<td className="py-2.5 pr-4 text-right text-slate-600">
												{formatDuration(tool.avgDurationMs)}
											</td>
											<td className="py-2.5 text-right">
												<Badge
													className={
														rate >= 90
															? "bg-emerald-100 text-emerald-800"
															: rate >= 70
																? "bg-amber-100 text-amber-800"
																: "bg-red-100 text-red-800"
													}
												>
													{rate}%
												</Badge>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</Card>
		</div>
	);
}
