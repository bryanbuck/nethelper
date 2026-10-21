-- Per-device connection test outcome (the credential's status is shared)
ALTER TABLE "Device" ADD COLUMN "apiTestStatus" TEXT;
ALTER TABLE "Device" ADD COLUMN "apiLastTested" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN "apiResponseTime" INTEGER;
ALTER TABLE "Device" ADD COLUMN "apiError" TEXT;
