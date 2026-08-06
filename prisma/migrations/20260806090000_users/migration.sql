-- Accounts.
--
-- Six of them, seeded on first boot: one admin and five users. Stored in the
-- database rather than in environment variables because the admin needs to
-- reset a password without opening Railway.

CREATE TABLE IF NOT EXISTS "User" (
  "id"           TEXT NOT NULL,
  "username"     TEXT NOT NULL,
  "displayName"  TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role"         TEXT NOT NULL DEFAULT 'user',
  "active"       BOOLEAN NOT NULL DEFAULT true,
  -- Bumped on password change, which invalidates cookies already issued.
  "tokenVersion" INTEGER NOT NULL DEFAULT 1,
  "lastLoginAt"  TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");
CREATE INDEX IF NOT EXISTS "User_username_idx" ON "User"("username");
