-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "PermissionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "integration_accounts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'pipedream',
    "app_slug" TEXT NOT NULL,
    "app_name" TEXT NOT NULL,
    "auth_provision_id" TEXT NOT NULL,
    "external_user_id" TEXT NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_requests" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "agent_run_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "tool_input" JSONB NOT NULL,
    "status" "PermissionStatus" NOT NULL DEFAULT 'PENDING',
    "slack_channel" TEXT,
    "slack_message_ts" TEXT,
    "approved_by" TEXT,
    "approval_code" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "permission_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_accounts_workspace_id_provider_auth_provision_id_key" ON "integration_accounts"("workspace_id", "provider", "auth_provision_id");

-- CreateIndex
CREATE INDEX "integration_accounts_workspace_id_provider_idx" ON "integration_accounts"("workspace_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "permission_requests_approval_code_key" ON "permission_requests"("approval_code");

-- CreateIndex
CREATE INDEX "permission_requests_workspace_id_status_idx" ON "permission_requests"("workspace_id", "status");

-- AddForeignKey
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_requests" ADD CONSTRAINT "permission_requests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permission_requests" ADD CONSTRAINT "permission_requests_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
