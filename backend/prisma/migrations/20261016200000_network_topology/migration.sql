-- AlterTable
ALTER TABLE "DiscoveredDevice" ADD COLUMN     "subnet" TEXT;

-- CreateTable
CREATE TABLE "DeviceLink" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "localPort" TEXT NOT NULL,
    "remoteChassisId" TEXT NOT NULL,
    "remotePortId" TEXT NOT NULL,
    "remoteSysName" TEXT,
    "remoteSysDesc" TEXT,
    "remotePortDesc" TEXT,
    "remoteMgmtIp" TEXT,
    "remoteMac" TEXT,
    "remoteCapabilities" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceTopologyState" (
    "deviceId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT,
    "chassisId" TEXT,
    "sysName" TEXT,
    "neighborCount" INTEGER NOT NULL DEFAULT 0,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMP(3),

    CONSTRAINT "DeviceTopologyState_pkey" PRIMARY KEY ("deviceId")
);

-- CreateTable
CREATE TABLE "TopologyChange" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "localPort" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TopologyChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapLayout" (
    "scope" TEXT NOT NULL,
    "positions" JSONB NOT NULL DEFAULT '{}',
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapLayout_pkey" PRIMARY KEY ("scope")
);

-- CreateIndex
CREATE INDEX "DeviceLink_deviceId_active_idx" ON "DeviceLink"("deviceId", "active");

-- CreateIndex
CREATE INDEX "DeviceLink_remoteMac_idx" ON "DeviceLink"("remoteMac");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceLink_deviceId_localPort_remoteChassisId_remotePortId_key" ON "DeviceLink"("deviceId", "localPort", "remoteChassisId", "remotePortId");

-- CreateIndex
CREATE INDEX "TopologyChange_deviceId_occurredAt_idx" ON "TopologyChange"("deviceId", "occurredAt");

-- CreateIndex
CREATE INDEX "TopologyChange_occurredAt_idx" ON "TopologyChange"("occurredAt");

-- AddForeignKey
ALTER TABLE "DeviceLink" ADD CONSTRAINT "DeviceLink_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceTopologyState" ADD CONSTRAINT "DeviceTopologyState_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopologyChange" ADD CONSTRAINT "TopologyChange_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

