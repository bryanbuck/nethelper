-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "liveMonitoring" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DeviceEvent" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "port" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeviceEvent_deviceId_occurredAt_idx" ON "DeviceEvent"("deviceId", "occurredAt");

-- CreateIndex
CREATE INDEX "DeviceEvent_type_idx" ON "DeviceEvent"("type");

-- CreateIndex
CREATE INDEX "DeviceEvent_occurredAt_idx" ON "DeviceEvent"("occurredAt");

-- AddForeignKey
ALTER TABLE "DeviceEvent" ADD CONSTRAINT "DeviceEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

