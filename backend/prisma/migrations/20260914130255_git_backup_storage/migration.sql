-- AlterTable
ALTER TABLE "ConfigBackup" ADD COLUMN     "commitSha" TEXT,
ADD COLUMN     "format" TEXT;

-- CreateTable
CREATE TABLE "GitBackupConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Config Backup Repository',
    "repoPath" TEXT NOT NULL,
    "remoteUrl" TEXT,
    "branch" TEXT NOT NULL DEFAULT 'main',
    "authorName" TEXT NOT NULL DEFAULT 'NetHelper',
    "authorEmail" TEXT NOT NULL DEFAULT 'nethelper@localhost',
    "credentials" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "lastTested" TIMESTAMP(3),
    "lastTestStatus" "TestStatus",
    "lastPush" TIMESTAMP(3),
    "lastPushError" TEXT,
    "notes" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitBackupConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GitBackupConfig_isActive_idx" ON "GitBackupConfig"("isActive");

-- CreateIndex
CREATE INDEX "GitBackupConfig_userId_idx" ON "GitBackupConfig"("userId");

-- AddForeignKey
ALTER TABLE "GitBackupConfig" ADD CONSTRAINT "GitBackupConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
