-- CreateEnum
CREATE TYPE "ApiCredentialType" AS ENUM ('switch', 'ap', 'gateway', 'controller', 'other');

-- CreateEnum
CREATE TYPE "TestStatus" AS ENUM ('success', 'failed');

-- CreateTable
CREATE TABLE "ApiCredential" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ApiCredentialType" NOT NULL,
    "deviceId" TEXT,
    "username" TEXT,
    "password" TEXT,
    "apiKey" TEXT,
    "apiSecret" TEXT,
    "notes" TEXT,
    "lastTested" TIMESTAMP(3),
    "lastTestStatus" "TestStatus",
    "metadata" JSONB,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApiCredential_deviceId_idx" ON "ApiCredential"("deviceId");

-- CreateIndex
CREATE INDEX "ApiCredential_type_idx" ON "ApiCredential"("type");

-- CreateIndex
CREATE INDEX "ApiCredential_userId_idx" ON "ApiCredential"("userId");

-- AddForeignKey
ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
