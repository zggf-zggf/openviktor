-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CronJobType" ADD VALUE 'ONBOARDING';
ALTER TYPE "CronJobType" ADD VALUE 'CHANNEL_INTRO';

-- AlterEnum
ALTER TYPE "TriggerType" ADD VALUE 'ONBOARDING';

-- DropIndex
DROP INDEX "tool_definitions_name_key";

-- AlterTable
ALTER TABLE "cron_jobs" ADD COLUMN     "max_runs" INTEGER;

-- AlterTable
ALTER TABLE "skills" ADD COLUMN     "category" TEXT;

-- CreateIndex
CREATE INDEX "skills_workspace_id_category_idx" ON "skills"("workspace_id", "category");

-- RenameIndex
ALTER INDEX "integration_accounts_workspace_id_provider_auth_provision_id_ke" RENAME TO "integration_accounts_workspace_id_provider_auth_provision_i_key";
