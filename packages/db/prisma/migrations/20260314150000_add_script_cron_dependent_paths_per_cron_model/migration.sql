-- AlterEnum
ALTER TYPE "CronJobType" ADD VALUE 'SCRIPT';

-- AlterTable
ALTER TABLE "cron_jobs" ADD COLUMN "model" TEXT,
ADD COLUMN "script_command" TEXT,
ADD COLUMN "dependent_paths" TEXT[] DEFAULT ARRAY[]::TEXT[];
