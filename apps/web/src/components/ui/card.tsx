import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function Card({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm", className)}>
			{children}
		</div>
	);
}

export function CardHeader({
	title,
	action,
}: {
	title: string;
	action?: ReactNode;
}) {
	return (
		<div className="mb-4 flex items-center justify-between">
			<h3 className="text-sm font-semibold text-slate-900">{title}</h3>
			{action}
		</div>
	);
}
