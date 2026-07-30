-- Ask tracking: the hard loop-breaker for repeated questions.
ALTER TABLE "Run" ADD COLUMN IF NOT EXISTS "lastAskedSlot" TEXT;
ALTER TABLE "Run" ADD COLUMN IF NOT EXISTS "lastAskedCount" INTEGER NOT NULL DEFAULT 0;
