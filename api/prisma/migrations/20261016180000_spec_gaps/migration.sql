-- Spec gap fixes (spec/README.md open questions 2, 3, 5, 6, 7, 9, 12, 15 and team-lead decisions, 2026-10-16).
-- Non-destructive for real data: data is moved before columns are dropped.

-- 1. Themes: products[] replaces the single nullable product (NULL meant "every product").
ALTER TABLE "themes" ADD COLUMN "products" "ProductType"[] NOT NULL
  DEFAULT ARRAY['wedding_invite', 'save_the_date', 'birthday', 'bridesmaid']::"ProductType"[];
UPDATE "themes" SET "products" = ARRAY["product"] WHERE "product" IS NOT NULL;
ALTER TABLE "themes" DROP COLUMN "product";

-- 2. Reviews: no ratings anywhere (the public API never showed them).
ALTER TABLE "reviews" DROP COLUMN "rating";

-- 3. Cover types 'illustration' and 'video' are retired → 'glow'.
UPDATE "invitations" SET "config" = jsonb_set("config", '{cover,type}', '"glow"')
  WHERE jsonb_typeof("config"->'cover') = 'object' AND "config"->'cover'->>'type' IN ('illustration', 'video');
UPDATE "invitation_versions" SET "config" = jsonb_set("config", '{cover,type}', '"glow"')
  WHERE jsonb_typeof("config"->'cover') = 'object' AND "config"->'cover'->>'type' IN ('illustration', 'video');
UPDATE "themes" SET "default_config" = jsonb_set("default_config", '{cover,type}', '"glow"')
  WHERE jsonb_typeof("default_config"->'cover') = 'object' AND "default_config"->'cover'->>'type' IN ('illustration', 'video');

-- 4. Add-ons: reminder_pack is withdrawn. The row stays (inactive) so past orders keep their label;
--    no plan offers it any more. extra_language is offered on every tier.
UPDATE "extras" SET "active" = false WHERE "code" = 'reminder_pack';
DELETE FROM "plan_extras" WHERE "extra_code" = 'reminder_pack';
INSERT INTO "plan_extras" ("plan_code", "extra_code")
  SELECT p."code", 'extra_language' FROM "plans" p
  WHERE p."code" IN ('diy', 'experience', 'premium') AND EXISTS (SELECT 1 FROM "extras" WHERE "code" = 'extra_language')
  ON CONFLICT DO NOTHING;

-- 5. Language limits per plan: Self-serve 2, Signature 3, Couture 5.
UPDATE "plans" SET "max_languages" = 2 WHERE "code" = 'diy';
UPDATE "plans" SET "max_languages" = 3 WHERE "code" = 'experience';
UPDATE "plans" SET "max_languages" = 5 WHERE "code" = 'premium';

-- 6. Own-song uploads need an explicit rights confirmation (timestamp kept on the asset).
ALTER TABLE "assets" ADD COLUMN "rights_confirmed_at" TIMESTAMP(3);

-- 7. Draft/live split: guests see the latest published snapshot; edits stay in the draft until "Publish changes".
ALTER TABLE "invitations" ADD COLUMN "has_unpublished_changes" BOOLEAN NOT NULL DEFAULT false;
-- Until now, edits after publishing went live immediately. Snapshot what guests currently see so nothing changes for them.
WITH bumped AS (
  UPDATE "invitations" i SET "version" = i."version" + 1
  WHERE i."status" IN ('published', 'archived')
    AND NOT EXISTS (
      SELECT 1 FROM "invitation_versions" v
      WHERE v."invitation_id" = i."id" AND v."version" = i."version"
        AND v."content" = i."content" AND v."config" = i."config" AND v."theme_id" IS NOT DISTINCT FROM i."theme_id")
  RETURNING i."id", i."version", i."theme_id", i."content", i."config"
)
INSERT INTO "invitation_versions" ("id", "invitation_id", "version", "theme_id", "content", "config", "published_by", "created_at")
  SELECT gen_random_uuid(), "id", "version", "theme_id", "content", "config", NULL, CURRENT_TIMESTAMP FROM bumped;
