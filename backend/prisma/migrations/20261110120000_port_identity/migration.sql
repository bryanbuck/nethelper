-- CreateTable
CREATE TABLE "PortNote" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "port" TEXT NOT NULL,
    "portLabel" TEXT NOT NULL,
    "label" VARCHAR(64),
    "location" TEXT,
    "owner" TEXT,
    "notes" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'auto',
    "expectedMac" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortNoteRevision" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "port" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortNoteRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortClient" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "port" TEXT NOT NULL,
    "portLabel" TEXT NOT NULL,
    "mac" TEXT NOT NULL,
    "ip" TEXT,
    "hostname" TEXT,
    "vendor" TEXT,
    "vlan" INTEGER,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "lldp" JSONB,
    "state" TEXT NOT NULL DEFAULT 'present',
    "missedReads" INTEGER NOT NULL DEFAULT 0,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "goneAt" TIMESTAMP(3),
    "goneReason" TEXT,
    "goneDetail" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortReadState" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "error" TEXT,
    "portSummary" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortReadState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PortNote_expectedMac_idx" ON "PortNote"("expectedMac");

-- CreateIndex
CREATE UNIQUE INDEX "PortNote_deviceId_port_key" ON "PortNote"("deviceId", "port");

-- CreateIndex
CREATE INDEX "PortNoteRevision_deviceId_port_createdAt_idx" ON "PortNoteRevision"("deviceId", "port", "createdAt");

-- CreateIndex
CREATE INDEX "PortClient_deviceId_state_idx" ON "PortClient"("deviceId", "state");

-- CreateIndex
CREATE INDEX "PortClient_mac_idx" ON "PortClient"("mac");

-- CreateIndex
CREATE INDEX "PortClient_ip_idx" ON "PortClient"("ip");

-- CreateIndex
CREATE UNIQUE INDEX "PortClient_deviceId_port_mac_key" ON "PortClient"("deviceId", "port", "mac");

-- CreateIndex
CREATE UNIQUE INDEX "PortReadState_deviceId_source_key" ON "PortReadState"("deviceId", "source");

-- AddForeignKey
ALTER TABLE "PortNote" ADD CONSTRAINT "PortNote_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortNote" ADD CONSTRAINT "PortNote_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortNoteRevision" ADD CONSTRAINT "PortNoteRevision_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortNoteRevision" ADD CONSTRAINT "PortNoteRevision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortClient" ADD CONSTRAINT "PortClient_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortReadState" ADD CONSTRAINT "PortReadState_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
