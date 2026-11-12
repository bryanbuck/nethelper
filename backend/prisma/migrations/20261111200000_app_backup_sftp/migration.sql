-- Application backup: an SFTP destination for off-host copies, and each run's
-- upload result, and when the schedule last changed (the overdue check).
-- Additive only.
ALTER TABLE "AppBackupConfig" ADD COLUMN "scheduleChangedAt" TIMESTAMP(3);
ALTER TABLE "AppBackupConfig" ADD COLUMN "remoteType" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "AppBackupConfig" ADD COLUMN "sftpHost" TEXT;
ALTER TABLE "AppBackupConfig" ADD COLUMN "sftpPort" INTEGER NOT NULL DEFAULT 22;
ALTER TABLE "AppBackupConfig" ADD COLUMN "sftpUsername" TEXT;
ALTER TABLE "AppBackupConfig" ADD COLUMN "sftpPassword" TEXT;
ALTER TABLE "AppBackupConfig" ADD COLUMN "sftpPrivateKey" TEXT;
ALTER TABLE "AppBackupConfig" ADD COLUMN "sftpKeyPassphrase" TEXT;
ALTER TABLE "AppBackupConfig" ADD COLUMN "sftpPath" TEXT;
ALTER TABLE "AppBackupConfig" ADD COLUMN "sftpHostKey" TEXT;

ALTER TABLE "AppBackupRun" ADD COLUMN "remoteStatus" TEXT;
ALTER TABLE "AppBackupRun" ADD COLUMN "remoteError" TEXT;
