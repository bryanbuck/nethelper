-- A backup can succeed without everything it should hold, e.g. a Mist-managed
-- Junos switch whose NETCONF read was refused, backed up from Mist alone.
ALTER TABLE "ConfigBackup" ADD COLUMN "warning" TEXT;
