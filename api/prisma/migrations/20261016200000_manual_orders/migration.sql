-- Manual admin sales create a real paid order (spec/data-model.md §order_items). Additive only; no data is dropped.
-- orders.payment_provider = 'manual' marks the source; created_by_admin_id records the admin who made the sale.
ALTER TABLE "orders" ADD COLUMN "created_by_admin_id" UUID;
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "orders_created_by_admin_id_idx" ON "orders"("created_by_admin_id");

-- Backfill (idempotent): every event marked paid with no paid/refunded order gets a manual paid order with its
-- plan line at the plan's base price. Add-ons of old manual sales were never stored, so only the plan is recorded.
CREATE TEMP TABLE "_manual_backfill" AS
SELECT e."id" AS event_id, gen_random_uuid() AS order_id,
       COALESCE(e."plan_code", CASE WHEN e."service_mode" = 'self_serve' THEN 'diy'::"PlanCode" END) AS plan_code,
       e."paid_at", e."languages", e."express",
       (SELECT m."user_id" FROM "event_members" m WHERE m."event_id" = e."id" AND m."role" = 'owner' ORDER BY m."created_at" LIMIT 1) AS owner_id,
       (SELECT a."actor_id" FROM "activity_log" a WHERE a."event_id" = e."id" AND a."action" = 'event.created_manually' AND a."actor_type" = 'admin' ORDER BY a."created_at" DESC LIMIT 1) AS admin_id
FROM "events" e
WHERE e."paid_at" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "orders" o WHERE o."event_id" = e."id" AND o."status" IN ('paid', 'refunded'));
DELETE FROM "_manual_backfill" WHERE "plan_code" IS NULL;

INSERT INTO "orders" ("id", "number", "user_id", "event_id", "email", "plan_code", "sections", "extras", "languages", "buyer_info",
  "subtotal_cents", "total_cents", "currency", "status", "payment_provider", "paid_at", "consent_terms_at", "consent_privacy_at",
  "express", "kind", "created_by_admin_id", "created_at", "updated_at")
SELECT b.order_id,
       'ORD-' || EXTRACT(YEAR FROM b.paid_at)::int || '-' || LPAD(nextval('order_number_seq')::text, 5, '0'),
       b.owner_id, b.event_id, COALESCE(u."email", 'unknown@manual.invalid'), b.plan_code, '{}', '{}', b."languages",
       jsonb_build_object('email', u."email", 'backfilled', true),
       p."base_price_cents", p."base_price_cents", p."currency", 'paid', 'manual', b.paid_at, b.paid_at, b.paid_at,
       b."express", 'plan', b.admin_id, b.paid_at, now()
FROM "_manual_backfill" b
JOIN "plans" p ON p."code" = b.plan_code
LEFT JOIN "users" u ON u."id" = b.owner_id;

INSERT INTO "order_items" ("id", "order_id", "kind", "code", "label", "qty", "unit_price_cents")
SELECT gen_random_uuid(), b.order_id, 'plan', p."code"::text, COALESCE(p."name_i18n"->>'en', p."code"::text), 1, p."base_price_cents"
FROM "_manual_backfill" b JOIN "plans" p ON p."code" = b.plan_code;

INSERT INTO "activity_log" ("id", "event_id", "actor_type", "actor_id", "action", "data", "created_at")
SELECT gen_random_uuid(), b.event_id, 'system', NULL, 'order.manual_backfilled', jsonb_build_object('orderId', b.order_id), now()
FROM "_manual_backfill" b JOIN "plans" p ON p."code" = b.plan_code;

DROP TABLE "_manual_backfill";
