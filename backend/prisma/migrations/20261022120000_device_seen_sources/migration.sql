-- Per-source "seen alive" times (ping reply, cloud read, cloud's own last-seen)
ALTER TABLE "Device" ADD COLUMN "pingLastSeen" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN "cloudCheckedAt" TIMESTAMP(3);
ALTER TABLE "Device" ADD COLUMN "cloudLastSeen" TIMESTAMP(3);
