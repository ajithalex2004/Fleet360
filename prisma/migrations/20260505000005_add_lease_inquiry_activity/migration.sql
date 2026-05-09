-- Activity log for inquiry pipeline: every call, email, meeting, or note that
-- a sales rep records against a lease inquiry. Append-only — edits are tracked
-- by replacing with a new entry, never mutating history.
CREATE TABLE IF NOT EXISTS "lease_inquiry_activities" (
  "id"                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"        TIMESTAMPTZ  DEFAULT NOW(),
  "inquiry_id"        UUID         NOT NULL,
  "activity_type"     TEXT         NOT NULL,   -- NOTE|CALL|EMAIL|MEETING|SMS|WHATSAPP|FOLLOW_UP_DUE
  "subject"           TEXT,
  "body"              TEXT,
  "outcome"           TEXT,                    -- e.g. NO_ANSWER|INTERESTED|NOT_INTERESTED|CALLBACK_REQUESTED
  "performed_at"      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "performed_by_id"   TEXT,
  "performed_by_name" TEXT,
  "follow_up_at"      TIMESTAMPTZ,
  "follow_up_done"    BOOLEAN      DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS "idx_lease_inquiry_activities_inquiry_id"
  ON "lease_inquiry_activities" ("inquiry_id");
CREATE INDEX IF NOT EXISTS "idx_lease_inquiry_activities_follow_up_at"
  ON "lease_inquiry_activities" ("follow_up_at")
  WHERE "follow_up_done" = FALSE AND "follow_up_at" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_lease_inquiry_activities_performed_at"
  ON "lease_inquiry_activities" ("performed_at");
