-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Untitled ICP',
    "slots" JSONB NOT NULL DEFAULT '{}',
    "slotMeta" JSONB NOT NULL DEFAULT '{}',
    "missing" JSONB NOT NULL DEFAULT '[]',
    "ambiguities" JSONB NOT NULL DEFAULT '[]',
    "siteContext" TEXT,
    "siteFetchStatus" TEXT,
    "siteFetchedUrl" TEXT,
    "siteNoticeShown" BOOLEAN NOT NULL DEFAULT false,
    "regulated" BOOLEAN NOT NULL DEFAULT false,
    "regulatedReason" TEXT,
    "masterPromptVersion" TEXT NOT NULL,
    "awarenessResolvedInChat" BOOLEAN NOT NULL DEFAULT false,
    "awarenessModalAnswered" BOOLEAN NOT NULL DEFAULT false,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "serviceIndex" INTEGER NOT NULL,
    "serviceName" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "awarenessLabel" TEXT NOT NULL,
    "markdown" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "validation" JSONB,
    "badge" TEXT,
    "errorMessage" TEXT,
    "masterPromptVersion" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "slotsSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comparison" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "serviceIndex" INTEGER NOT NULL,
    "serviceName" TEXT NOT NULL,
    "rows" JSONB NOT NULL DEFAULT '[]',
    "markdown" TEXT NOT NULL DEFAULT '',
    "scenarioKeys" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageLog" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "kind" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Run_updatedAt_idx" ON "Run"("updatedAt");

-- CreateIndex
CREATE INDEX "Message_runId_seq_idx" ON "Message"("runId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Message_runId_seq_key" ON "Message"("runId", "seq");

-- CreateIndex
CREATE INDEX "Document_runId_idx" ON "Document"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_runId_serviceIndex_scenario_key" ON "Document"("runId", "serviceIndex", "scenario");

-- CreateIndex
CREATE INDEX "Comparison_runId_idx" ON "Comparison"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "Comparison_runId_serviceIndex_key" ON "Comparison"("runId", "serviceIndex");

-- CreateIndex
CREATE INDEX "UsageLog_runId_createdAt_idx" ON "UsageLog"("runId", "createdAt");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comparison" ADD CONSTRAINT "Comparison_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageLog" ADD CONSTRAINT "UsageLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

