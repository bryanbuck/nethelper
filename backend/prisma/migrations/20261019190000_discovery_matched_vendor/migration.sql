-- Discovery matched only Aruba/HPE: a boolean flag and an "Aruba hosts" count.
-- It now records which vendor a host belongs to (cloud inventory match, else
-- OUI). Hand-written so existing results keep their flag as vendor 'aruba'
-- (Prisma's diff would drop the column).

ALTER TABLE "DiscoveredDevice" ADD COLUMN "matchedVendor" "Vendor";
UPDATE "DiscoveredDevice" SET "matchedVendor" = 'aruba' WHERE "isArubaVendor" = true;
ALTER TABLE "DiscoveredDevice" DROP COLUMN "isArubaVendor";

ALTER TABLE "DiscoveryScan" RENAME COLUMN "arubaHosts" TO "vendorHosts";
