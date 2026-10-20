-- AlterEnum
ALTER TYPE "BackupTrigger" ADD VALUE 'automation';

-- DropForeignKey
ALTER TABLE "Execution" DROP CONSTRAINT "Execution_automationId_fkey";

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "acknowledgedByAutomationId" TEXT;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_acknowledgedByAutomationId_fkey" FOREIGN KEY ("acknowledgedByAutomationId") REFERENCES "Automation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
