/*
  Warnings:

  - You are about to drop the column `type` on the `Automation` table. All the data in the column will be lost.
  - You are about to drop the column `workflow` on the `Automation` table. All the data in the column will be lost.
  - Added the required column `category` to the `Automation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `elements` to the `Automation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `priority` to the `Automation` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AutomationCategory" AS ENUM ('network', 'security', 'monitoring', 'maintenance', 'compliance');

-- CreateEnum
CREATE TYPE "AutomationPriority" AS ENUM ('low', 'medium', 'high', 'critical');

-- AlterTable
ALTER TABLE "Automation" DROP COLUMN "type",
DROP COLUMN "workflow",
ADD COLUMN     "category" "AutomationCategory" NOT NULL,
ADD COLUMN     "elements" JSONB NOT NULL,
ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastRun" TIMESTAMP(3),
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "priority" "AutomationPriority" NOT NULL,
ALTER COLUMN "active" SET DEFAULT false;
