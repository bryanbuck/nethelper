-- Boot images (primary/secondary, default, booted) as the last poll read them
ALTER TABLE "Device" ADD COLUMN "firmwareImages" JSONB;
