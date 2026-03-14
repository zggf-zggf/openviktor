-- AlterTable
ALTER TABLE "threads" ADD COLUMN "path" TEXT,
ADD COLUMN "title" TEXT,
ADD COLUMN "parent_thread_id" TEXT;

-- AlterEnum
ALTER TYPE "TriggerType" ADD VALUE 'SPAWN';

-- CreateIndex
CREATE INDEX "threads_parent_thread_id_idx" ON "threads"("parent_thread_id");

-- CreateIndex (unique compound for workspace + path, allows multiple NULLs)
CREATE UNIQUE INDEX "threads_workspace_id_path_key" ON "threads"("workspace_id", "path");

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_parent_thread_id_fkey" FOREIGN KEY ("parent_thread_id") REFERENCES "threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
