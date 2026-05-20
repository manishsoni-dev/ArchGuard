-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'ENQUEUED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "AnalysisRunStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "AnalysisRun" RENAME COLUMN "checkRunId" TO "githubCheckRunId";

-- AlterTable
ALTER TABLE "AnalysisRun" ALTER COLUMN "status" TYPE "AnalysisRunStatus" USING "status"::"AnalysisRunStatus";

-- AlterTable
ALTER TABLE "AnalysisRun" ADD COLUMN "errorMessage" TEXT;

-- AlterTable
ALTER TABLE "AnalysisRun" ALTER COLUMN "startedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "AnalysisRun" ALTER COLUMN "startedAt" DROP NOT NULL;

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "repositoryId" TEXT,
    "githubDeliveryId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "action" TEXT,
    "repositoryFullName" TEXT,
    "pullRequestNumber" INTEGER,
    "payloadJson" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "status" "WebhookEventStatus" NOT NULL,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_githubDeliveryId_key" ON "WebhookEvent"("githubDeliveryId");

-- CreateIndex
CREATE INDEX "WebhookEvent_tenantId_idx" ON "WebhookEvent"("tenantId");

-- CreateIndex
CREATE INDEX "WebhookEvent_repositoryId_idx" ON "WebhookEvent"("repositoryId");

-- CreateIndex
CREATE INDEX "WebhookEvent_eventName_idx" ON "WebhookEvent"("eventName");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_idx" ON "WebhookEvent"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisRun_pullRequestId_headSha_key" ON "AnalysisRun"("pullRequestId", "headSha");

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE SET NULL ON UPDATE CASCADE;
