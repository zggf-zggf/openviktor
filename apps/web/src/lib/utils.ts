import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function formatCost(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

export function formatDuration(ms: number | null): string {
	if (ms === null) return "-";
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 60_000).toFixed(1)}m`;
}

export function formatTokens(n: number): string {
	if (n < 1000) return String(n);
	if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
	return `${(n / 1_000_000).toFixed(2)}M`;
}

export function statusColor(status: string): string {
	switch (status) {
		case "COMPLETED":
			return "bg-emerald-100 text-emerald-800";
		case "RUNNING":
			return "bg-blue-100 text-blue-800";
		case "QUEUED":
			return "bg-amber-100 text-amber-800";
		case "FAILED":
			return "bg-red-100 text-red-800";
		case "CANCELLED":
			return "bg-slate-100 text-slate-800";
		default:
			return "bg-slate-100 text-slate-600";
	}
}

export function threadStatusColor(status: string): string {
	switch (status) {
		case "ACTIVE":
			return "bg-emerald-100 text-emerald-800";
		case "WAITING":
			return "bg-amber-100 text-amber-800";
		case "COMPLETED":
			return "bg-slate-100 text-slate-600";
		case "STALE":
			return "bg-red-100 text-red-800";
		default:
			return "bg-slate-100 text-slate-600";
	}
}
