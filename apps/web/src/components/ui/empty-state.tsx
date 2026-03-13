import { Inbox } from "lucide-react";

export function EmptyState({ message }: { message: string }) {
	return (
		<div className="flex flex-col items-center justify-center py-16 text-slate-400">
			<Inbox className="mb-3 h-10 w-10" />
			<p className="text-sm">{message}</p>
		</div>
	);
}
