-- CreateTable
CREATE TABLE "AppBackupConfig" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "cronExpression" TEXT NOT NULL DEFAULT '0 2 * * *',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "retainCount" INTEGER NOT NULL DEFAULT 14,
    "retainDays" INTEGER,
    "includeHistory" BOOLEAN NOT NULL DEFAULT true,
    "includeGitRepo" BOOLEAN NOT NULL DEFAULT false,
    "encrypt" BOOLEAN NOT NULL DEFAULT false,
    "passphrase" TEXT,
    "includeKey" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppBackupConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppBackupRun" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "fileName" TEXT,
    "sizeBytes" BIGINT,
    "sha256" TEXT,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "triggeredBy" TEXT,

    CONSTRAINT "AppBackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppBackupRun_startedAt_idx" ON "AppBackupRun"("startedAt");

