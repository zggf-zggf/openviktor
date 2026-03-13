import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

export function StatCard({
	label,
	value,
	subValue,
	icon: Icon,
	color = "primary",
}: {
	label: string;
	value: string;
	subValue?: string;
	icon: LucideIcon;
	color?: "primary" | "emerald" | "amber" | "red";
}) {
	const colors = {
		primary: "bg-primary-50 text-primary-600",
		emerald: "bg-emerald-50 text-emerald-600",
		amber: "bg-amber-50 text-amber-600",
		red: "bg-red-50 text-red-600",
	};

	return (
		<div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
			<div className="flex items-start justify-between">
				<div>
					<p className="text-sm text-slate-500">{label}</p>
					<p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
					{subValue && <p className="mt-0.5 text-xs text-slate-400">{subValue}</p>}
				</div>
				<div className={cn("rounded-lg p-2.5", colors[color])}>
					<Icon className="h-5 w-5" />
				</div>
			</div>
		</div>
	);
}
