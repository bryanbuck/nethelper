-- AlterTable
ALTER TABLE "DeviceTopologyState" ADD COLUMN     "vxlan" JSONB,
ADD COLUMN     "vxlanSource" TEXT,
ADD COLUMN     "vxlanCollectedAt" TIMESTAMP(3),
ADD COLUMN     "vxlanError" TEXT;
