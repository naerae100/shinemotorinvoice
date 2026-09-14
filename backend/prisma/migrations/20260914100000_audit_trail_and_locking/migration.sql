-- Authenticity: an append-only audit trail, one-way document issue locking, and
-- the ability to withdraw a JWT that has already been handed out.

-- ── Token revocation ────────────────────────────────────────────────────────
-- A token carries the version it was signed with; raising this invalidates every
-- token already in the wild for that user.
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- ── Issue locking ───────────────────────────────────────────────────────────
-- Once a document has been handed to a supplier or sent to a buyer it stops
-- being a draft, and the API refuses further edits.
ALTER TABLE "Docket"        ADD COLUMN "issuedAt" TIMESTAMP(3);
ALTER TABLE "ExportInvoice" ADD COLUMN "issuedAt" TIMESTAMP(3);

-- ── Audit trail ─────────────────────────────────────────────────────────────
CREATE TABLE "AuditEvent" (
  "id"         TEXT NOT NULL,
  "at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorId"    TEXT,
  "actorEmail" TEXT,
  "action"     TEXT NOT NULL,
  "entity"     TEXT NOT NULL,
  "entityId"   TEXT NOT NULL,
  "label"      TEXT,
  "before"     JSONB,
  "after"      JSONB,
  "ip"         TEXT,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditEvent_entity_entityId_idx" ON "AuditEvent"("entity", "entityId");
CREATE INDEX "AuditEvent_at_idx"              ON "AuditEvent"("at");
CREATE INDEX "AuditEvent_actorId_idx"         ON "AuditEvent"("actorId");

-- Users are never deleted (documents reference them), but SET NULL keeps the
-- trail readable via actorEmail even if that ever changes.
ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
