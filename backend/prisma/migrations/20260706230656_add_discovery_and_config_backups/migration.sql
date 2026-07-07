-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "DiscoveredDeviceStatus" AS ENUM ('new', 'imported', 'ignored');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('pending', 'running', 'success', 'failed');

-- CreateEnum
CREATE TYPE "BackupTrigger" AS ENUM ('manual', 'scheduled');

-- CreateTable
CREATE TABLE "DiscoveryScan" (
    "id" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'pending',
    "subnets" JSONB NOT NULL,
    "totalHosts" INTEGER NOT NULL DEFAULT 0,
    "arubaHosts" INTEGER NOT NULL DEFAULT 0,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "triggeredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveryScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveredDevice" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "macAddress" TEXT,
    "vendor" TEXT,
    "hostname" TEXT,
    "isArubaVendor" BOOLEAN NOT NULL DEFAULT false,
    "openPorts" JSONB,
    "suggestedType" "DeviceType",
    "suggestedName" TEXT,
    "centralSerial" TEXT,
    "centralMatch" JSONB,
    "existingDeviceId" TEXT,
    "conflictType" TEXT,
    "status" "DiscoveredDeviceStatus" NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoveredDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupSchedule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deviceSelection" JSONB NOT NULL,
    "retentionDays" INTEGER NOT NULL DEFAULT 90,
    "retentionMaxCount" INTEGER NOT NULL DEFAULT 30,
    "lastRun" TIMESTAMP(3),
    "nextRun" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigBackup" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "deviceSerial" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'pending',
    "trigger" "BackupTrigger" NOT NULL DEFAULT 'manual',
    "scheduleId" TEXT,
    "filePath" TEXT,
    "checksum" TEXT,
    "sizeBytes" INTEGER,
    "hasChanges" BOOLEAN,
    "error" TEXT,
    "triggeredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfigBackup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoveryScan_status_idx" ON "DiscoveryScan"("status");

-- CreateIndex
CREATE INDEX "DiscoveryScan_createdAt_idx" ON "DiscoveryScan"("createdAt");

-- CreateIndex
CREATE INDEX "DiscoveredDevice_scanId_idx" ON "DiscoveredDevice"("scanId");

-- CreateIndex
CREATE INDEX "DiscoveredDevice_status_idx" ON "DiscoveredDevice"("status");

-- CreateIndex
CREATE INDEX "DiscoveredDevice_macAddress_idx" ON "DiscoveredDevice"("macAddress");

-- CreateIndex
CREATE INDEX "BackupSchedule_active_idx" ON "BackupSchedule"("active");

-- CreateIndex
CREATE INDEX "ConfigBackup_deviceId_createdAt_idx" ON "ConfigBackup"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "ConfigBackup_deviceSerial_idx" ON "ConfigBackup"("deviceSerial");

-- CreateIndex
CREATE INDEX "ConfigBackup_status_idx" ON "ConfigBackup"("status");

-- CreateIndex
CREATE INDEX "ConfigBackup_scheduleId_idx" ON "ConfigBackup"("scheduleId");

-- AddForeignKey
ALTER TABLE "DiscoveredDevice" ADD CONSTRAINT "DiscoveredDevice_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "DiscoveryScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigBackup" ADD CONSTRAINT "ConfigBackup_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "BackupSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
