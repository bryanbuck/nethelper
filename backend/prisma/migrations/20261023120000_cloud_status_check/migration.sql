-- One status-refresh stamp per cloud integration, instead of rewriting
-- Device.cloudCheckedAt on every row at every refresh (#50).
CREATE TABLE "CloudStatusCheck" (
    "integrationId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloudStatusCheck_pkey" PRIMARY KEY ("integrationId")
);
