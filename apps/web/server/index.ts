import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { cronJobsRoutes } from "./routes/cron-jobs";
import { knowledgeRoutes } from "./routes/knowledge";
import { overviewRoutes } from "./routes/overview";
import { runsRoutes } from "./routes/runs";
import { settingsRoutes } from "./routes/settings";
import { threadsRoutes } from "./routes/threads";
import { toolsRoutes } from "./routes/tools";

const app = new Hono();

app.use("/api/*", cors());

app.use("/api/*", async (c, next) => {
	const apiKey = process.env.ADMIN_API_KEY;
	if (apiKey) {
		const auth = c.req.header("Authorization");
		if (auth !== `Bearer ${apiKey}`) {
			return c.json({ error: "Unauthorized" }, 401);
		}
	}
	await next();
});

app.route("/api", overviewRoutes);
app.route("/api", runsRoutes);
app.route("/api", toolsRoutes);
app.route("/api", threadsRoutes);
app.route("/api", knowledgeRoutes);
app.route("/api", cronJobsRoutes);
app.route("/api", settingsRoutes);

if (process.env.NODE_ENV === "production") {
	app.use("/*", serveStatic({ root: "./dist" }));
	app.get("*", serveStatic({ path: "./dist/index.html" }));
}

const port = Number(process.env.WEB_PORT) || 3001;
console.log(`OpenViktor Admin API listening on http://localhost:${port}`);

export default { port, fetch: app.fetch };
