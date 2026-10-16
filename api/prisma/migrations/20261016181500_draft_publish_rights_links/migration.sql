-- Spec [Decided, pending build] items 16–22 + team-lead decisions (2026-10-16).

-- Draft vs published: content/config are always the draft; guests see invitation_versions(published_version).
ALTER TABLE "invitations" DROP COLUMN "has_unpublished_changes";
ALTER TABLE "invitations" ADD COLUMN "published_version" INTEGER;
ALTER TABLE "invitations" ADD COLUMN "draft_changed_at" TIMESTAMP(3);
-- Everything ever published points at its latest snapshot (the previous migration snapshotted what guests saw).
UPDATE "invitations" i SET "published_version" = i."version"
  WHERE i."version" > 0 AND EXISTS (SELECT 1 FROM "invitation_versions" v WHERE v."invitation_id" = i."id" AND v."version" = i."version");

-- Old slugs keep working after a custom_link rename.
CREATE TABLE "invitation_slug_aliases" (
  "slug" TEXT NOT NULL,
  "invitation_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invitation_slug_aliases_pkey" PRIMARY KEY ("slug")
);
CREATE INDEX "invitation_slug_aliases_invitation_id_idx" ON "invitation_slug_aliases"("invitation_id");
ALTER TABLE "invitation_slug_aliases" ADD CONSTRAINT "invitation_slug_aliases_invitation_id_fkey"
  FOREIGN KEY ("invitation_id") REFERENCES "invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Self-serve add-ons picked before paying (pre-fill the pay dialog).
ALTER TABLE "events" ADD COLUMN "selected_extras" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Orders: a plan purchase, or an add-on-only purchase for an already paid event.
ALTER TABLE "orders" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'plan';

-- Own-song rights: one row per tick (upload, link, brief or explicit endpoint). Replaces assets.rights_confirmed_at.
ALTER TABLE "assets" DROP COLUMN "rights_confirmed_at";
CREATE TABLE "music_rights_confirmations" (
  "id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "user_id" UUID,
  "asset_id" UUID,
  "url" TEXT,
  "statement" TEXT NOT NULL,
  "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip_hash" TEXT,
  "user_agent" TEXT,
  CONSTRAINT "music_rights_confirmations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "music_rights_confirmations_one_target" CHECK (("asset_id" IS NULL) <> ("url" IS NULL))
);
CREATE INDEX "music_rights_confirmations_event_id_idx" ON "music_rights_confirmations"("event_id");
ALTER TABLE "music_rights_confirmations" ADD CONSTRAINT "music_rights_confirmations_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "music_rights_confirmations" ADD CONSTRAINT "music_rights_confirmations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
