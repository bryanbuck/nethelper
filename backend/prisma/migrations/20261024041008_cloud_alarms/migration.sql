-- CreateTable
CREATE TABLE "CloudAlarm" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "severity" TEXT NOT NULL,
    "stateful" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "deviceId" TEXT,
    "siteName" TEXT,
    "summary" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "raisedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "clearedAt" TIMESTAMP(3),
    "clearedReason" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloudAlarm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CloudAlarm_raisedAt_idx" ON "CloudAlarm"("raisedAt");

-- CreateIndex
CREATE INDEX "CloudAlarm_clearedAt_idx" ON "CloudAlarm"("clearedAt");

-- CreateIndex
CREATE INDEX "CloudAlarm_deviceId_idx" ON "CloudAlarm"("deviceId");

-- CreateIndex
CREATE INDEX "CloudAlarm_integrationId_status_idx" ON "CloudAlarm"("integrationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CloudAlarm_integrationId_externalId_key" ON "CloudAlarm"("integrationId", "externalId");

-- AddForeignKey
ALTER TABLE "CloudAlarm" ADD CONSTRAINT "CloudAlarm_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
