-- CreateEnum
CREATE TYPE "CronJobType" AS ENUM ('HEARTBEAT', 'CUSTOM');

-- AlterTable: Add new columns to cron_jobs
ALTER TABLE "cron_jobs" ADD COLUMN "type" "CronJobType" NOT NULL DEFAULT 'CUSTOM';
ALTER TABLE "cron_jobs" ADD COLUMN "slack_channel" TEXT;
ALTER TABLE "cron_jobs" ADD COLUMN "run_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "cron_jobs" ADD COLUMN "last_run_status" "RunStatus";

-- AlterTable: Add cronJobId to agent_runs
ALTER TABLE "agent_runs" ADD COLUMN "cron_job_id" TEXT;

-- CreateIndex
CREATE INDEX "cron_jobs_enabled_next_run_at_idx" ON "cron_jobs"("enabled", "next_run_at");

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_cron_job_id_fkey" FOREIGN KEY ("cron_job_id") REFERENCES "cron_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
