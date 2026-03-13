import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { Card, CardHeader } from "../components/ui/card";
import type { ToolCallItem } from "../lib/api";
import { getRunDetail } from "../lib/api";
import { formatCost, formatDuration, formatTokens, statusColor } from "../lib/utils";

export function RunDetailPage() {
	const { id } = useParams<{ id: string }>();
	const {
		data: run,
		isLoading,
		error,
	} = useQuery({
		queryKey: ["run", id],
		queryFn: () => getRunDetail(id as string),
		enabled: !!id,
	});

	if (isLoading) {
		return (
			<div className="space-y-4">
				<div className="h-8 w-48 animate-pulse rounded bg-slate-200" />
				<div className="h-40 animate-pulse rounded-xl border border-slate-200 bg-white" />
			</div>
		);
	}

	if (error || !run) {
		return (
			<div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
				{error ? (error as Error).message : "Run not found"}
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-3">
				<Link
					to="/runs"
					className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
				>
					<ArrowLeft className="h-5 w-5" />
				</Link>
				<h1 className="text-2xl font-bold text-slate-900">Run Detail</h1>
				<Badge className={statusColor(run.status)}>{run.status}</Badge>
			</div>

			<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
				<MetaItem label="Trigger" value={run.triggerType} />
				<MetaItem label="Model" value={run.model} mono />
				<MetaItem label="Cost" value={formatCost(run.costCents)} />
				<MetaItem label="Duration" value={formatDuration(run.durationMs)} />
				<MetaItem
					label="Tokens (in/out)"
					value={`${formatTokens(run.inputTokens)} / ${formatTokens(run.outputTokens)}`}
				/>
				<MetaItem
					label="Started"
					value={run.startedAt ? format(new Date(run.startedAt), "MMM d, HH:mm:ss") : "-"}
				/>
				<MetaItem
					label="Completed"
					value={run.completedAt ? format(new Date(run.completedAt), "MMM d, HH:mm:ss") : "-"}
				/>
				{run.thread && <MetaItem label="Thread" value={`#${run.thread.slackChannel}`} />}
			</div>

			{run.errorMessage && (
				<div className="rounded-lg border border-red-200 bg-red-50 p-4">
					<p className="text-xs font-medium text-red-800">Error</p>
					<p className="mt-1 whitespace-pre-wrap font-mono text-sm text-red-700">
						{run.errorMessage}
					</p>
				</div>
			)}

			<Card>
				<CardHeader title={`Messages (${run.messages.length})`} />
				{run.messages.length === 0 ? (
					<p className="text-sm text-slate-400">No messages recorded</p>
				) : (
					<div className="space-y-3">
						{run.messages.map((msg) => (
							<div
								key={msg.id}
								className={`rounded-lg p-3 ${
									msg.role === "user"
										? "border border-slate-200 bg-slate-50"
										: "border border-primary-100 bg-primary-50"
								}`}
							>
								<div className="mb-1.5 flex items-center justify-between">
									<span className="text-xs font-semibold uppercase text-slate-500">{msg.role}</span>
									<span className="text-xs text-slate-400">
										{formatTokens(msg.tokenCount)} tokens
									</span>
								</div>
								<p className="whitespace-pre-wrap text-sm text-slate-700">{msg.content}</p>
							</div>
						))}
					</div>
				)}
			</Card>

			<Card>
				<CardHeader title={`Tool Calls (${run.toolCalls.length})`} />
				{run.toolCalls.length === 0 ? (
					<p className="text-sm text-slate-400">No tool calls recorded</p>
				) : (
					<div className="space-y-2">
						{run.toolCalls.map((tc) => (
							<ToolCallRow key={tc.id} toolCall={tc} />
						))}
					</div>
				)}
			</Card>
		</div>
	);
}

function MetaItem({
	label,
	value,
	mono,
}: {
	label: string;
	value: string;
	mono?: boolean;
}) {
	return (
		<div className="rounded-lg border border-slate-200 bg-white p-3">
			<p className="text-xs text-slate-500">{label}</p>
			<p className={`mt-0.5 text-sm font-medium text-slate-900 ${mono ? "font-mono text-xs" : ""}`}>
				{value}
			</p>
		</div>
	);
}

function ToolCallRow({ toolCall }: { toolCall: ToolCallItem }) {
	const [open, setOpen] = useState(false);

	return (
		<div className="rounded-lg border border-slate-200">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-slate-50"
			>
				{open ? (
					<ChevronDown className="h-4 w-4 text-slate-400" />
				) : (
					<ChevronRight className="h-4 w-4 text-slate-400" />
				)}
				<span className="font-mono font-medium text-slate-700">{toolCall.toolName}</span>
				<Badge className={statusColor(toolCall.status)}>{toolCall.status}</Badge>
				<span className="ml-auto text-xs text-slate-400">
					{formatDuration(toolCall.durationMs)}
				</span>
			</button>
			{open && (
				<div className="space-y-3 border-t border-slate-100 p-4">
					{toolCall.errorMessage && (
						<div className="rounded bg-red-50 p-2 font-mono text-xs text-red-700">
							{toolCall.errorMessage}
						</div>
					)}
					<div>
						<p className="mb-1 text-xs font-semibold text-slate-500">Input</p>
						<pre className="max-h-48 overflow-auto rounded bg-slate-50 p-2 font-mono text-xs text-slate-700">
							{JSON.stringify(toolCall.input, null, 2)}
						</pre>
					</div>
					{toolCall.output !== null && (
						<div>
							<p className="mb-1 text-xs font-semibold text-slate-500">Output</p>
							<pre className="max-h-48 overflow-auto rounded bg-slate-50 p-2 font-mono text-xs text-slate-700">
								{JSON.stringify(toolCall.output, null, 2)}
							</pre>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
