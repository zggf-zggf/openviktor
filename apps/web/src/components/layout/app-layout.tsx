import {
	Activity,
	Bot,
	Brain,
	Calendar,
	Cpu,
	LayoutDashboard,
	MessageSquare,
	Settings,
	Wrench,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { cn } from "../../lib/utils";

const navigation = [
	{ name: "Overview", href: "/", icon: LayoutDashboard },
	{ name: "Agent Runs", href: "/runs", icon: Activity },
	{ name: "Tools", href: "/tools", icon: Wrench },
	{ name: "Threads", href: "/threads", icon: MessageSquare },
	{ name: "Knowledge", href: "/knowledge", icon: Brain },
	{ name: "Cron Jobs", href: "/cron-jobs", icon: Calendar },
	{ name: "Settings", href: "/settings", icon: Settings },
];

export function AppLayout() {
	return (
		<div className="flex h-screen">
			<aside className="flex w-60 flex-col border-r border-slate-200 bg-white">
				<div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4">
					<Cpu className="h-6 w-6 text-primary-600" />
					<span className="text-lg font-semibold tracking-tight">OpenViktor</span>
				</div>
				<nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
					{navigation.map((item) => (
						<NavLink
							key={item.href}
							to={item.href}
							end={item.href === "/"}
							className={({ isActive }) =>
								cn(
									"flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
									isActive
										? "bg-primary-50 text-primary-700"
										: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
								)
							}
						>
							<item.icon className="h-4 w-4" />
							{item.name}
						</NavLink>
					))}
				</nav>
				<div className="border-t border-slate-200 p-3">
					<div className="flex items-center gap-2 text-xs text-slate-400">
						<Bot className="h-3.5 w-3.5" />
						<span>Admin Dashboard</span>
					</div>
				</div>
			</aside>
			<main className="flex-1 overflow-y-auto bg-slate-50 p-6">
				<Outlet />
			</main>
		</div>
	);
}
