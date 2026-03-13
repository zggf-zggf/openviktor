import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState } from "react";
import { Badge } from "../components/ui/badge";
import { Card, CardHeader } from "../components/ui/card";
import { EmptyState } from "../components/ui/empty-state";
import { getLearnings, getSkills } from "../lib/api";

type Tab = "learnings" | "skills";

export function KnowledgePage() {
	const [tab, setTab] = useState<Tab>("learnings");

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold text-slate-900">Knowledge</h1>

			<div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
				<TabButton active={tab === "learnings"} onClick={() => setTab("learnings")}>
					Learnings
				</TabButton>
				<TabButton active={tab === "skills"} onClick={() => setTab("skills")}>
					Skills
				</TabButton>
			</div>

			{tab === "learnings" ? <LearningsTab /> : <SkillsTab />}
		</div>
	);
}

function TabButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
				active ? "bg-primary-50 text-primary-700" : "text-slate-500 hover:text-slate-700"
			}`}
		>
			{children}
		</button>
	);
}

function LearningsTab() {
	const [page, setPage] = useState(1);
	const [search, setSearch] = useState("");

	const { data, isLoading } = useQuery({
		queryKey: ["learnings", page, search],
		queryFn: () => getLearnings({ page, limit: 20, search }),
	});

	const totalPages = data ? Math.ceil(data.total / data.limit) : 0;

	return (
		<div className="space-y-4">
			<input
				type="text"
				placeholder="Search learnings..."
				value={search}
				onChange={(e) => {
					setSearch(e.target.value);
					setPage(1);
				}}
				className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-primary-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
			/>

			{isLoading ? (
				<div className="space-y-3">
					{["k1", "k2", "k3"].map((key) => (
						<div
							key={key}
							className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white"
						/>
					))}
				</div>
			) : !data || data.data.length === 0 ? (
				<Card>
					<EmptyState message="No learnings found" />
				</Card>
			) : (
				<div className="space-y-3">
					{data.data.map((learning) => (
						<Card key={learning.id}>
							<div className="flex items-start justify-between gap-4">
								<p className="flex-1 text-sm text-slate-700">{learning.content}</p>
								{learning.category && (
									<Badge className="bg-slate-100 text-slate-600">{learning.category}</Badge>
								)}
							</div>
							<div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
								<span>Source: {learning.source}</span>
								<span>{format(new Date(learning.createdAt), "MMM d, yyyy")}</span>
							</div>
						</Card>
					))}
				</div>
			)}

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

function SkillsTab() {
	const [page, setPage] = useState(1);

	const { data, isLoading } = useQuery({
		queryKey: ["skills", page],
		queryFn: () => getSkills({ page, limit: 20 }),
	});

	const totalPages = data ? Math.ceil(data.total / data.limit) : 0;

	return (
		<div className="space-y-4">
			{isLoading ? (
				<div className="space-y-3">
					{["k1", "k2", "k3"].map((key) => (
						<div
							key={key}
							className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white"
						/>
					))}
				</div>
			) : !data || data.data.length === 0 ? (
				<Card>
					<EmptyState message="No skills registered" />
				</Card>
			) : (
				<div className="space-y-3">
					{data.data.map((skill) => (
						<Card key={skill.id}>
							<div className="flex items-center justify-between">
								<h3 className="font-mono text-sm font-semibold text-slate-800">{skill.name}</h3>
								<Badge className="bg-primary-100 text-primary-700">v{skill.version}</Badge>
							</div>
							<p className="mt-2 line-clamp-3 text-sm text-slate-600">{skill.content}</p>
							<div className="mt-2 text-xs text-slate-400">
								Updated {format(new Date(skill.updatedAt), "MMM d, yyyy")}
							</div>
						</Card>
					))}
				</div>
			)}

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
