-- Reusable per-industry domain context, cached across runs.
CREATE TABLE IF NOT EXISTS "IndustryPack" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "canonicalIndustry" TEXT NOT NULL,
    "industryRaw" TEXT NOT NULL,
    "aliases" JSONB NOT NULL DEFAULT '[]',
    "region" TEXT NOT NULL,
    "businessModel" TEXT NOT NULL,
    "audienceType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "curatedId" TEXT,
    "content" JSONB NOT NULL,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IndustryPack_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "IndustryPack_key_key" ON "IndustryPack"("key");
CREATE INDEX IF NOT EXISTS "IndustryPack_canonicalIndustry_idx" ON "IndustryPack"("canonicalIndustry");

ALTER TABLE "Run" ADD COLUMN IF NOT EXISTS "industryPackId" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "industryPackId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Run" ADD CONSTRAINT "Run_industryPackId_fkey"
    FOREIGN KEY ("industryPackId") REFERENCES "IndustryPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Document" ADD CONSTRAINT "Document_industryPackId_fkey"
    FOREIGN KEY ("industryPackId") REFERENCES "IndustryPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
