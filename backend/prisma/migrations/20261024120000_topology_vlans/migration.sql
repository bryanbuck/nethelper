-- AlterTable
ALTER TABLE "DeviceTopologyState" ADD COLUMN     "vlans" JSONB,
ADD COLUMN     "vlanSource" TEXT,
ADD COLUMN     "vlanCollectedAt" TIMESTAMP(3),
ADD COLUMN     "vlanError" TEXT;
