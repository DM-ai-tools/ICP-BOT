-- Sub-service discovery and the scope choice.
--
-- A site that sells seventeen loan products and one that sells a single service
-- look identical until someone reads past the homepage. These columns hold what
-- that read found, and what the strategist decided to do about it.
--
-- Every column is additive with a default, so an existing run keeps working:
-- discoveryStatus 'idle' and scopeResolved false read as "never looked", and a
-- run that never looks behaves exactly as it did before this feature existed.

ALTER TABLE "Run" ADD COLUMN IF NOT EXISTS "discoveryStatus" TEXT DEFAULT 'idle';
ALTER TABLE "Run" ADD COLUMN IF NOT EXISTS "discoveredServices" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Run" ADD COLUMN IF NOT EXISTS "discoveryPagesRead" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Run" ADD COLUMN IF NOT EXISTS "scopeChoice" TEXT;
ALTER TABLE "Run" ADD COLUMN IF NOT EXISTS "scopeResolved" BOOLEAN NOT NULL DEFAULT false;

-- Documents record which tier they belong to so the export can build its folder
-- tree without rehydrating every slot snapshot. Existing documents are all
-- whole-business profiles, which is exactly what the default says.
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "tier" TEXT NOT NULL DEFAULT 'generic';
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "serviceSlug" TEXT;
