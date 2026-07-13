-- Multi-vendor Phase 0 groundwork (see docs/MULTI_VENDOR_ROADMAP.md).
-- Hand-written: Prisma's diff would drop/recreate for the enum-value and
-- column renames below, losing data. Everything here is rename/additive plus
-- two data backfills; nothing is dropped.

-- Rename ManagementMode value: central -> cloud (renamed values are usable
-- immediately, unlike ADD VALUE)
ALTER TYPE "ManagementMode" RENAME VALUE 'central' TO 'cloud';

-- Extend DeviceType (new values are NOT used inside this transaction, which is
-- all Postgres 12+ requires for in-transaction ADD VALUE)
ALTER TYPE "DeviceType" ADD VALUE 'controller';
ALTER TYPE "DeviceType" ADD VALUE 'other';

-- CreateEnum
CREATE TYPE "Vendor" AS ENUM ('aruba', 'juniper', 'cisco', 'other');

-- CreateEnum
CREATE TYPE "CloudProviderType" AS ENUM ('aruba_central', 'juniper_mist', 'cisco_meraki');

-- Rename Aruba-specific Device columns to their cloud-generic names
ALTER TABLE "Device" RENAME COLUMN "centralStatus" TO "cloudStatus";
ALTER TABLE "Device" RENAME COLUMN "centralManaged" TO "cloudManaged";
ALTER TABLE "Device" RENAME COLUMN "centralConnectionStatus" TO "cloudConnectionStatus";
ALTER TABLE "Device" RENAME COLUMN "centralManagedSource" TO "cloudManagedSource";
ALTER TABLE "Device" RENAME COLUMN "centralManagedCheckedAt" TO "cloudManagedCheckedAt";

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "vendor" "Vendor" NOT NULL DEFAULT 'aruba',
ADD COLUMN     "platform" TEXT,
ADD COLUMN     "cloudIntegrationId" TEXT;

-- CreateTable
CREATE TABLE "CloudIntegration" (
    "id" TEXT NOT NULL,
    "provider" "CloudProviderType" NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "credentials" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastTested" TIMESTAMP(3),
    "lastTestStatus" "TestStatus",
    "notes" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloudIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CloudIntegration_provider_isActive_idx" ON "CloudIntegration"("provider", "isActive");

-- CreateIndex
CREATE INDEX "CloudIntegration_userId_idx" ON "CloudIntegration"("userId");

-- CreateIndex
CREATE INDEX "Device_cloudIntegrationId_idx" ON "Device"("cloudIntegrationId");

-- AddForeignKey
ALTER TABLE "CloudIntegration" ADD CONSTRAINT "CloudIntegration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_cloudIntegrationId_fkey" FOREIGN KEY ("cloudIntegrationId") REFERENCES "CloudIntegration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data migration 1/2: copy ArubaCentralConfig rows into CloudIntegration.
-- IDs are reused (nothing references ArubaCentralConfig) and clientSecret is
-- already encrypted, so it stays encrypted inside the JSON blob.
INSERT INTO "CloudIntegration"
    ("id", "provider", "name", "baseUrl", "credentials", "isActive",
     "lastTested", "lastTestStatus", "notes", "userId", "createdAt", "updatedAt")
SELECT
    "id",
    'aruba_central'::"CloudProviderType",
    'Aruba Central',
    "baseUrl",
    jsonb_build_object(
        'clientId', "clientId",
        'clientSecret', "clientSecret",
        'customerId', "customerId"
    ),
    "isActive",
    "lastTested",
    "lastTestStatus",
    "notes",
    "userId",
    "createdAt",
    "updatedAt"
FROM "ArubaCentralConfig";

-- Attribute existing cloud-managed (formerly 'central') devices to the active
-- migrated Central integration. No-op when no active integration exists.
UPDATE "Device"
SET "cloudIntegrationId" = (
    SELECT "id" FROM "CloudIntegration"
    WHERE "provider" = 'aruba_central' AND "isActive" = true
    ORDER BY "createdAt" DESC
    LIMIT 1
)
WHERE "managementMode" = 'cloud';

-- Data migration 2/2: backfill Device.platform for switches, mirroring the
-- detection order of src/utils/device-platform.js#detectPlatform():
-- metadata OS string first (authoritative), then model-number patterns.
-- Rows that stay NULL keep today's "unknown platform" default behavior.
UPDATE "Device" SET "platform" = 'aos-cx'
WHERE "platform" IS NULL AND "type" = 'switch'
  AND (metadata->>'operatingSystem' = 'AOS-CX' OR metadata->>'os' = 'AOS-CX');

UPDATE "Device" SET "platform" = 'aos-s'
WHERE "platform" IS NULL AND "type" = 'switch'
  AND (metadata->>'operatingSystem' = 'AOS-Switch' OR metadata->>'os' = 'AOS-Switch');

UPDATE "Device" SET "platform" = 'aos-cx'
WHERE "platform" IS NULL AND "type" = 'switch'
  AND lower("model") ~ 'cx|\m83(60|25)|\m63(00|10)|\m64(00|10)';

UPDATE "Device" SET "platform" = 'aos-s'
WHERE "platform" IS NULL AND "type" = 'switch'
  AND (lower("model") ~ '29[0-9][0-9]|25[0-9][0-9]|54[0-9][0-9]|38[0-9][0-9]'
       OR lower("model") LIKE '%aos-s%');
