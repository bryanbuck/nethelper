-- Refactor API credential relationship to link from Device to ApiCredential
-- This migration safely migrates existing data from ApiCredential.deviceId to Device.apiCredentialId

-- Step 1: Add the new apiCredentialId column to Device table
ALTER TABLE "Device" ADD COLUMN "apiCredentialId" TEXT;

-- Step 2: Migrate existing data from ApiCredential.deviceId to Device.apiCredentialId
-- For each ApiCredential that has a deviceId, update that Device to point back to the credential
UPDATE "Device" d
SET "apiCredentialId" = ac.id
FROM "ApiCredential" ac
WHERE ac."deviceId" = d.id;

-- Step 3: Create index on the new foreign key
CREATE INDEX "Device_apiCredentialId_idx" ON "Device"("apiCredentialId");

-- Step 4: Add the foreign key constraint
ALTER TABLE "Device" ADD CONSTRAINT "Device_apiCredentialId_fkey"
    FOREIGN KEY ("apiCredentialId") REFERENCES "ApiCredential"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 5: Drop the old foreign key and index from ApiCredential
ALTER TABLE "ApiCredential" DROP CONSTRAINT IF EXISTS "ApiCredential_deviceId_fkey";
DROP INDEX IF EXISTS "ApiCredential_deviceId_idx";

-- Step 6: Drop the old deviceId column from ApiCredential
ALTER TABLE "ApiCredential" DROP COLUMN "deviceId";
