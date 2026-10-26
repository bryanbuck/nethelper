-- AlterTable
ALTER TABLE "NotificationChannel" ADD COLUMN     "cloudAlarms" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cloudAlarmNames" TEXT[] DEFAULT ARRAY[]::TEXT[];
