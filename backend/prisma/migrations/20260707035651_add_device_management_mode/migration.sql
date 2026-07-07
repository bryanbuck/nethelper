-- CreateEnum
CREATE TYPE "ManagementMode" AS ENUM ('central', 'direct');

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "managementMode" "ManagementMode" NOT NULL DEFAULT 'direct';
