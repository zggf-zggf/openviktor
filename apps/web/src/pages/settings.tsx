import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardHeader } from "../components/ui/card";
import { EmptyState } from "../components/ui/empty-state";
import { getSettings } from "../lib/api";

export function SettingsPage() {
	const { data: workspaces, isLoading } = useQuery({
		queryKey: ["settings"],
		queryFn: getSettings,
	});

	if (isLoading) {
		return (
			<div className="space-y-6">
				<div className="h-8 w-32 animate-pulse rounded bg-slate-200" />
				<div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white" />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold text-slate-900">Settings</h1>

			{!workspaces || workspaces.length === 0 ? (
				<Card>
					<EmptyState message="No workspaces found" />
				</Card>
			) : (
				workspaces.map((ws) => (
					<Card key={ws.id}>
						<CardHeader title={ws.slackTeamName} />

						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<InfoRow label="Workspace ID" value={ws.id} mono />
							<InfoRow label="Slack Team ID" value={ws.slackTeamId} mono />
							<InfoRow
								label="Created"
								value={format(new Date(ws.createdAt), "MMM d, yyyy HH:mm")}
							/>
							<InfoRow label="Members" value={String(ws.memberCount)} />
						</div>

						{ws.members.length > 0 && (
							<div className="mt-5">
								<h4 className="mb-2 text-xs font-semibold text-slate-500">
									Members ({ws.members.length})
								</h4>
								<div className="overflow-x-auto">
									<table className="w-full text-sm">
										<thead>
											<tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
												<th className="pb-2 pr-4">Display Name</th>
												<th className="pb-2 pr-4">Slack User ID</th>
												<th className="pb-2">ID</th>
											</tr>
										</thead>
										<tbody>
											{ws.members.map((m) => (
												<tr key={m.id} className="border-b border-slate-50">
													<td className="py-2 pr-4 text-slate-700">{m.displayName ?? "-"}</td>
													<td className="py-2 pr-4 font-mono text-xs text-slate-500">
														{m.slackUserId}
													</td>
													<td className="py-2 font-mono text-xs text-slate-400">{m.id}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</div>
						)}

						{Object.keys(ws.settings as Record<string, unknown>).length > 0 && (
							<div className="mt-5">
								<h4 className="mb-2 text-xs font-semibold text-slate-500">Settings</h4>
								<pre className="max-h-48 overflow-auto rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-700">
									{JSON.stringify(ws.settings, null, 2)}
								</pre>
							</div>
						)}
					</Card>
				))
			)}
		</div>
	);
}

function InfoRow({
	label,
	value,
	mono,
}: {
	label: string;
	value: string;
	mono?: boolean;
}) {
	return (
		<div>
			<p className="text-xs text-slate-500">{label}</p>
			<p className={`mt-0.5 text-sm text-slate-800 ${mono ? "font-mono text-xs" : ""}`}>{value}</p>
		</div>
	);
}
