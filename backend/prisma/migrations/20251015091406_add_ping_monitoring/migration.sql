-- AlterTable: Rename existing status column to centralStatus and add ping monitoring fields
ALTER TABLE "Device" RENAME COLUMN "status" TO "centralStatus";

-- AlterTable: Add new ping monitoring columns
ALTER TABLE "Device" ADD COLUMN "pingStatus" "DeviceStatus",
ADD COLUMN "pingLastChecked" TIMESTAMP(3),
ADD COLUMN "pingResponseTime" INTEGER,
ADD COLUMN "pingSuccessRate" DOUBLE PRECISION,
ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Device_pingStatus_idx" ON "Device"("pingStatus");

-- CreateIndex
CREATE INDEX "Device_pingLastChecked_idx" ON "Device"("pingLastChecked");
