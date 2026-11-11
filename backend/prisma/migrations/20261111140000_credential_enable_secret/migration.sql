-- Cisco IOS enable secret (field-encrypted like password), used only when the
-- device login lands at the user EXEC prompt
ALTER TABLE "ApiCredential" ADD COLUMN "enableSecret" TEXT;
