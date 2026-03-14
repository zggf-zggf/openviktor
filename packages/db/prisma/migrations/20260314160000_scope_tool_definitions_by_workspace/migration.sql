-- Step 1: Add workspace_id as nullable
ALTER TABLE "tool_definitions" ADD COLUMN "workspace_id" TEXT;

-- Step 2: Backfill from integration_accounts using appSlug stored in config JSON
UPDATE "tool_definitions" td
SET "workspace_id" = ia."workspace_id"
FROM "integration_accounts" ia
WHERE ia."app_slug" = td."config"->>'appSlug'
  AND ia."status" = 'ACTIVE'
  AND td."workspace_id" IS NULL;

-- Step 3: Delete orphaned rows that couldn't be backfilled (no matching active account)
DELETE FROM "tool_definitions" WHERE "workspace_id" IS NULL;

-- Step 4: Make column required
ALTER TABLE "tool_definitions" ALTER COLUMN "workspace_id" SET NOT NULL;

-- Step 5: Drop old unique constraint on name
ALTER TABLE "tool_definitions" DROP CONSTRAINT IF EXISTS "tool_definitions_name_key";

-- Step 6: Add new composite unique constraint
ALTER TABLE "tool_definitions" ADD CONSTRAINT "tool_definitions_workspace_id_name_key" UNIQUE ("workspace_id", "name");

-- Step 7: Add index for workspace + type lookups
CREATE INDEX "tool_definitions_workspace_id_type_idx" ON "tool_definitions"("workspace_id", "type");

-- Step 8: Add foreign key to workspaces
ALTER TABLE "tool_definitions" ADD CONSTRAINT "tool_definitions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
