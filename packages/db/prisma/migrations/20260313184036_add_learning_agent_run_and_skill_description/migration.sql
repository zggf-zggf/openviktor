-- AlterTable
ALTER TABLE "learnings" ADD COLUMN     "agent_run_id" TEXT;

-- AlterTable
ALTER TABLE "skills" ADD COLUMN     "description" TEXT;

-- AddForeignKey
ALTER TABLE "learnings" ADD CONSTRAINT "learnings_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
