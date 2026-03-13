import { Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/layout/app-layout";
import { CronJobsPage } from "./pages/cron-jobs";
import { KnowledgePage } from "./pages/knowledge";
import { OverviewPage } from "./pages/overview";
import { RunDetailPage } from "./pages/run-detail";
import { RunsPage } from "./pages/runs";
import { SettingsPage } from "./pages/settings";
import { ThreadsPage } from "./pages/threads";
import { ToolsPage } from "./pages/tools";

export function App() {
	return (
		<Routes>
			<Route element={<AppLayout />}>
				<Route index element={<OverviewPage />} />
				<Route path="runs" element={<RunsPage />} />
				<Route path="runs/:id" element={<RunDetailPage />} />
				<Route path="tools" element={<ToolsPage />} />
				<Route path="threads" element={<ThreadsPage />} />
				<Route path="knowledge" element={<KnowledgePage />} />
				<Route path="cron-jobs" element={<CronJobsPage />} />
				<Route path="settings" element={<SettingsPage />} />
			</Route>
		</Routes>
	);
}
