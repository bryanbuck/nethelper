-- Alert notification channels (email / webhook)
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "minSeverity" TEXT NOT NULL DEFAULT 'warning',
    "rules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastDeliveryAt" TIMESTAMP(3),
    "lastDeliveryStatus" TEXT,
    "lastDeliveryError" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationChannel_userId_idx" ON "NotificationChannel"("userId");

ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
