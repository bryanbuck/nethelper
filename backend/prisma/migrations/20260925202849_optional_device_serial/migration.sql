-- Device.serial becomes optional. Directly-managed devices often have no
-- known serial; the add-device form used to store '' for them, and because
-- serial is UNIQUE only one such device could exist. PostgreSQL unique
-- indexes allow any number of NULLs, so blank serials become NULL.
-- Hand-written (see CLAUDE.md): only a nullability change plus a data fix.
ALTER TABLE "Device" ALTER COLUMN "serial" DROP NOT NULL;
UPDATE "Device" SET "serial" = NULL WHERE btrim("serial") = '';
