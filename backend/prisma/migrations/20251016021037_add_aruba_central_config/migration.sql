-- CreateTable
CREATE TABLE "ArubaCentralConfig" (
    "id" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastTested" TIMESTAMP(3),
    "lastTestStatus" "TestStatus",
    "notes" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArubaCentralConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArubaCentralConfig_userId_idx" ON "ArubaCentralConfig"("userId");

-- CreateIndex
CREATE INDEX "ArubaCentralConfig_isActive_idx" ON "ArubaCentralConfig"("isActive");

-- AddForeignKey
ALTER TABLE "ArubaCentralConfig" ADD CONSTRAINT "ArubaCentralConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
