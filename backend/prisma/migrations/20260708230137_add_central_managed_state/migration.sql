-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "centralConnectionStatus" TEXT,
ADD COLUMN     "centralManaged" BOOLEAN,
ADD COLUMN     "centralManagedCheckedAt" TIMESTAMP(3),
ADD COLUMN     "centralManagedSource" TEXT;
