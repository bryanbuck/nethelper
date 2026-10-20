-- AlterTable
ALTER TABLE "BackupSchedule" ADD COLUMN     "includeScopes" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ConfigBackupArtifact" (
    "id" TEXT NOT NULL,
    "backupId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfigBackupArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScopeBackup" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "integrationName" TEXT NOT NULL,
    "provider" "CloudProviderType" NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "scopeName" TEXT NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'pending',
    "trigger" "BackupTrigger" NOT NULL DEFAULT 'manual',
    "scheduleId" TEXT,
    "filePath" TEXT,
    "checksum" TEXT,
    "sizeBytes" INTEGER,
    "hasChanges" BOOLEAN,
    "format" TEXT,
    "commitSha" TEXT,
    "error" TEXT,
    "triggeredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScopeBackup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConfigBackupArtifact_backupId_kind_key" ON "ConfigBackupArtifact"("backupId", "kind");

-- CreateIndex
CREATE INDEX "ScopeBackup_integrationId_scopeType_scopeId_createdAt_idx" ON "ScopeBackup"("integrationId", "scopeType", "scopeId", "createdAt");

-- CreateIndex
CREATE INDEX "ScopeBackup_status_idx" ON "ScopeBackup"("status");

-- AddForeignKey
ALTER TABLE "ConfigBackupArtifact" ADD CONSTRAINT "ConfigBackupArtifact_backupId_fkey" FOREIGN KEY ("backupId") REFERENCES "ConfigBackup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing successful backup gets one artifact row for the
-- file it already has. JSON formats are 'structured'; everything else is CLI.
INSERT INTO "ConfigBackupArtifact" ("id", "backupId", "kind", "format", "filePath", "checksum", "sizeBytes", "createdAt")
SELECT gen_random_uuid()::text,
       "id",
       CASE WHEN "format" LIKE '%json' THEN 'structured' ELSE 'cli' END,
       COALESCE("format", 'cli-text'),
       "filePath",
       "checksum",
       COALESCE("sizeBytes", 0),
       "createdAt"
FROM "ConfigBackup"
WHERE "status" = 'success' AND "filePath" IS NOT NULL AND "checksum" IS NOT NULL;
