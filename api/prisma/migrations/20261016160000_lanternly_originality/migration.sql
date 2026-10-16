-- Lanternly originality pass (design-review.md O1–O9). Non-destructive for real data:
-- schema tweaks, then JSON rewrites of reference-derived values. Catalogue rows (add-ons, themes,
-- sample reviews) are handled idempotently by prisma/seed.ts.

-- Themes can fit every product (product NULL).
ALTER TABLE "themes" ALTER COLUMN "product" DROP NOT NULL;

-- Reviews: no "verified" badge or star rating in public; explicit sample flag.
ALTER TABLE "reviews" ADD COLUMN "is_sample" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "reviews" ALTER COLUMN "rating" DROP NOT NULL;
ALTER TABLE "reviews" DROP COLUMN "verified";

-- config.cover.type 'envelope' → 'glow'; sealColor → glowColor; drop envelopeColor; opening 'unfold' → 'glow'.
CREATE OR REPLACE FUNCTION lanternly_migrate_config(c jsonb) RETURNS jsonb AS $$
DECLARE cov jsonb;
BEGIN
  IF c IS NULL OR jsonb_typeof(c) <> 'object' THEN RETURN c; END IF;
  IF jsonb_typeof(c->'cover') = 'object' THEN
    cov := c->'cover';
    IF cov->>'type' = 'envelope' THEN cov := jsonb_set(cov, '{type}', '"glow"'); END IF;
    IF cov ? 'sealColor' AND NOT cov ? 'glowColor' THEN cov := cov || jsonb_build_object('glowColor', cov->'sealColor'); END IF;
    cov := cov - 'envelopeColor' - 'sealColor';
    c := jsonb_set(c, '{cover}', cov);
  END IF;
  IF c->'opening'->>'animation' = 'unfold' THEN c := jsonb_set(c, '{opening,animation}', '"glow"'); END IF;
  RETURN c;
END $$ LANGUAGE plpgsql;

UPDATE "invitations" SET "config" = lanternly_migrate_config("config") WHERE "config"::text ~ '(envelope|sealColor|unfold)';
UPDATE "invitation_versions" SET "config" = lanternly_migrate_config("config") WHERE "config"::text ~ '(envelope|sealColor|unfold)';
UPDATE "themes" SET "default_config" = lanternly_migrate_config("default_config") WHERE "default_config"::text ~ '(envelope|sealColor|unfold)';
DROP FUNCTION lanternly_migrate_config(jsonb);

-- Briefs: custom_music → own_song, custom_wax_seal → custom_monogram (letters kept);
-- custom_illustration / animated_video sections are retired.
UPDATE "briefs" SET
  "data" = ("data" - 'custom_music' - 'custom_wax_seal' - 'custom_illustration' - 'animated_video')
    || CASE WHEN "data" ? 'custom_music' AND NOT "data" ? 'own_song' THEN jsonb_build_object('own_song', "data"->'custom_music') ELSE '{}'::jsonb END
    || CASE WHEN "data" ? 'custom_wax_seal' AND NOT "data" ? 'custom_monogram'
         THEN jsonb_build_object('custom_monogram', jsonb_strip_nulls(jsonb_build_object('letters', "data"->'custom_wax_seal'->'letters'))) ELSE '{}'::jsonb END,
  "sections" = ARRAY(
    SELECT x FROM (
      SELECT CASE s WHEN 'custom_music' THEN 'own_song' WHEN 'custom_wax_seal' THEN 'custom_monogram' ELSE s END AS x, ord
      FROM unnest("sections") WITH ORDINALITY AS u(s, ord)
      WHERE s NOT IN ('custom_illustration', 'animated_video')
    ) t GROUP BY x ORDER BY min(ord)
  ),
  "new_sections" = ARRAY(
    SELECT CASE s WHEN 'custom_music' THEN 'own_song' WHEN 'custom_wax_seal' THEN 'custom_monogram' ELSE s END
    FROM unnest("new_sections") AS s WHERE s NOT IN ('custom_illustration', 'animated_video')
  )
WHERE "data" ?| ARRAY['custom_music', 'custom_wax_seal', 'custom_illustration', 'animated_video']
   OR "sections" && ARRAY['custom_music', 'custom_wax_seal', 'custom_illustration', 'animated_video']
   OR "new_sections" && ARRAY['custom_music', 'custom_wax_seal', 'custom_illustration', 'animated_video'];

-- Unfinished checkout drafts: map old add-on codes to their replacements, drop the rest.
UPDATE "checkout_drafts" SET "extras" = ARRAY(
  SELECT DISTINCT CASE e WHEN 'custom_music' THEN 'own_song' WHEN 'wax_seal' THEN 'custom_monogram' WHEN 'express' THEN 'rush_design' ELSE e END
  FROM unnest("extras") AS e WHERE e NOT IN ('custom_color', 'illustration', 'animated_video', 'custom_domain')
) WHERE "extras" && ARRAY['custom_music', 'wax_seal', 'express', 'custom_color', 'illustration', 'animated_video', 'custom_domain'];
