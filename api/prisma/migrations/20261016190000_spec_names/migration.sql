-- Align names with the final spec (spec/data-model.md). Renames only; no data is dropped.

-- 1. Slug alias table → invitation_slug_redirects(old_slug, invitation_id, created_at). Rows are kept.
ALTER TABLE "invitation_slug_aliases" RENAME TO "invitation_slug_redirects";
ALTER TABLE "invitation_slug_redirects" RENAME COLUMN "slug" TO "old_slug";
ALTER TABLE "invitation_slug_redirects" RENAME CONSTRAINT "invitation_slug_aliases_pkey" TO "invitation_slug_redirects_pkey";
ALTER TABLE "invitation_slug_redirects" RENAME CONSTRAINT "invitation_slug_aliases_invitation_id_fkey" TO "invitation_slug_redirects_invitation_id_fkey";
ALTER INDEX "invitation_slug_aliases_invitation_id_idx" RENAME TO "invitation_slug_redirects_invitation_id_idx";

-- 2. orders.plan_code is null for add-on-only orders (kind = 'addons'); event_id identifies the event.
ALTER TABLE "orders" ALTER COLUMN "plan_code" DROP NOT NULL;
UPDATE "orders" SET "plan_code" = NULL WHERE "kind" = 'addons';
