-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('host', 'staff', 'admin');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('owner', 'cohost', 'viewer');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('wedding_invite', 'save_the_date', 'birthday', 'bridesmaid');

-- CreateEnum
CREATE TYPE "PlanCode" AS ENUM ('diy', 'std', 'experience', 'premium', 'birthday', 'bridesmaid');

-- CreateEnum
CREATE TYPE "ServiceMode" AS ENUM ('self_serve', 'studio');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('draft', 'pending_payment', 'paid', 'refunded', 'canceled');

-- CreateEnum
CREATE TYPE "ProductionStage" AS ENUM ('order_received', 'brief_received', 'in_queue', 'designing', 'review', 'delivered');

-- CreateEnum
CREATE TYPE "BriefStatus" AS ENUM ('not_started', 'in_progress', 'submitted', 'archived');

-- CreateEnum
CREATE TYPE "RevisionStatus" AS ENUM ('submitted', 'in_progress', 'completed');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('draft', 'preview', 'published', 'archived');

-- CreateEnum
CREATE TYPE "Attendance" AS ENUM ('yes', 'no', 'pending');

-- CreateEnum
CREATE TYPE "PartyMemberType" AS ENUM ('adult', 'child');

-- CreateEnum
CREATE TYPE "InviteeStatus" AS ENUM ('not_sent', 'sent', 'opened', 'responded', 'bounced', 'opted_out');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('email', 'sms', 'whatsapp', 'link', 'qr');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('queued', 'sending', 'sent', 'delivered', 'failed', 'bounced', 'opened');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('scheduled', 'running', 'done', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "TableShape" AS ENUM ('round', 'rect', 'square', 'u_shape', 'serpentine', 'head');

-- CreateEnum
CREATE TYPE "TokenPurpose" AS ENUM ('set_password', 'reset_password', 'login', 'cohost_invite');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'host',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "email_verified_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "disabled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "email" TEXT NOT NULL,
    "purpose" "TokenPurpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "event_id" UUID,
    "data" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "csrf_token" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "code" "PlanCode" NOT NULL,
    "product" "ProductType" NOT NULL,
    "service_mode" "ServiceMode" NOT NULL,
    "name_i18n" JSONB NOT NULL,
    "description_i18n" JSONB NOT NULL,
    "features" JSONB NOT NULL DEFAULT '[]',
    "base_price_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'CAD',
    "included_blocks" INTEGER,
    "extra_block_price_cents" INTEGER NOT NULL DEFAULT 0,
    "max_languages" INTEGER NOT NULL DEFAULT 1,
    "revision_rounds" INTEGER NOT NULL DEFAULT 0,
    "delivery_days" INTEGER,
    "includes_all_extras" BOOLEAN NOT NULL DEFAULT false,
    "has_rsvp" BOOLEAN NOT NULL DEFAULT true,
    "uses_sections" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "extras" (
    "code" TEXT NOT NULL,
    "name_i18n" JSONB NOT NULL,
    "description_i18n" JSONB NOT NULL,
    "price_cents" INTEGER,
    "currency" CHAR(3) NOT NULL DEFAULT 'CAD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "extras_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "plan_extras" (
    "plan_code" "PlanCode" NOT NULL,
    "extra_code" TEXT NOT NULL,

    CONSTRAINT "plan_extras_pkey" PRIMARY KEY ("plan_code","extra_code")
);

-- CreateTable
CREATE TABLE "themes" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "product" "ProductType" NOT NULL,
    "name_i18n" JSONB NOT NULL,
    "description_i18n" JSONB NOT NULL,
    "mood_tags" TEXT[],
    "preview_video_url" TEXT,
    "poster_url" TEXT,
    "demo_slug" TEXT,
    "is_new" BOOLEAN NOT NULL DEFAULT false,
    "is_popular" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "default_config" JSONB NOT NULL DEFAULT '{}',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "themes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "music_tracks" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "license" TEXT NOT NULL,
    "url" TEXT,
    "duration_s" INTEGER NOT NULL,
    "mood_tags" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "music_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_drafts" (
    "id" UUID NOT NULL,
    "plan_code" "PlanCode",
    "last_step" TEXT,
    "theme_key" TEXT,
    "sections" TEXT[],
    "extras" TEXT[],
    "languages" TEXT[],
    "info" JSONB,
    "email" TEXT,
    "vision" TEXT,
    "utm" JSONB,
    "abandoned" BOOLEAN NOT NULL DEFAULT false,
    "converted_order_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "user_id" UUID,
    "event_id" UUID,
    "email" TEXT NOT NULL,
    "plan_code" "PlanCode" NOT NULL,
    "theme_id" UUID,
    "sections" TEXT[],
    "extras" TEXT[],
    "languages" TEXT[],
    "vision" TEXT,
    "buyer_info" JSONB NOT NULL,
    "subtotal_cents" INTEGER NOT NULL,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "tax_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'CAD',
    "status" "OrderStatus" NOT NULL DEFAULT 'pending_payment',
    "payment_provider" TEXT NOT NULL,
    "checkout_session_id" TEXT,
    "payment_intent_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "consent_terms_at" TIMESTAMP(3) NOT NULL,
    "consent_privacy_at" TIMESTAMP(3) NOT NULL,
    "checkout_draft_id" UUID,
    "express" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "product" "ProductType" NOT NULL,
    "plan_code" "PlanCode",
    "service_mode" "ServiceMode" NOT NULL,
    "title" TEXT NOT NULL,
    "host_names" JSONB NOT NULL,
    "event_date" DATE,
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "venue_name" TEXT,
    "venue_address" TEXT,
    "primary_language" TEXT NOT NULL DEFAULT 'en',
    "languages" TEXT[] DEFAULT ARRAY['en']::TEXT[],
    "production_stage" "ProductionStage" NOT NULL DEFAULT 'order_received',
    "express" BOOLEAN NOT NULL DEFAULT false,
    "max_revision_rounds" INTEGER NOT NULL DEFAULT 2,
    "design_approved_at" TIMESTAMP(3),
    "invites_sent_manual" INTEGER NOT NULL DEFAULT 0,
    "rsvp_settings" JSONB NOT NULL DEFAULT '{}',
    "admin_note" TEXT,
    "assigned_staff_id" UUID,
    "high_season_notice" BOOLEAN NOT NULL DEFAULT false,
    "reminders_enabled" BOOLEAN NOT NULL DEFAULT false,
    "reminder_days_before" INTEGER NOT NULL DEFAULT 7,
    "notify_on_rsvp" BOOLEAN NOT NULL DEFAULT true,
    "paid_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "archive_after" DATE,
    "delivery_email_sent_at" TIMESTAMP(3),
    "delivery_email_sent_count" INTEGER NOT NULL DEFAULT 0,
    "deletion_requested_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_members" (
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MemberRole" NOT NULL,
    "invited_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_members_pkey" PRIMARY KEY ("event_id","user_id")
);

-- CreateTable
CREATE TABLE "briefs" (
    "event_id" UUID NOT NULL,
    "sections" TEXT[],
    "new_sections" TEXT[],
    "custom_block_names" JSONB NOT NULL DEFAULT '{}',
    "data" JSONB NOT NULL DEFAULT '{}',
    "status" "BriefStatus" NOT NULL DEFAULT 'not_started',
    "submitted_at" TIMESTAMP(3),
    "resubmission_count" INTEGER NOT NULL DEFAULT 0,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "briefs_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "uploaded_by" UUID,
    "kind" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revisions" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "round_number" INTEGER NOT NULL,
    "request" TEXT NOT NULL,
    "status" "RevisionStatus" NOT NULL DEFAULT 'submitted',
    "staff_note" TEXT,
    "created_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revision_comments" (
    "id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "author_id" UUID,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revision_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "kind" "ProductType" NOT NULL,
    "theme_id" UUID,
    "slug" TEXT NOT NULL,
    "custom_domain" TEXT,
    "status" "InvitationStatus" NOT NULL DEFAULT 'draft',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "content" JSONB NOT NULL DEFAULT '{}',
    "config" JSONB NOT NULL DEFAULT '{}',
    "preview_token" TEXT,
    "published_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation_versions" (
    "id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "theme_id" UUID,
    "content" JSONB NOT NULL,
    "config" JSONB NOT NULL,
    "published_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitees" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "household_name" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT,
    "email" TEXT,
    "phone_e164" TEXT,
    "language" TEXT,
    "max_party_size" INTEGER NOT NULL DEFAULT 1,
    "known_companions" JSONB NOT NULL DEFAULT '[]',
    "group_label" TEXT,
    "token" TEXT NOT NULL,
    "status" "InviteeStatus" NOT NULL DEFAULT 'not_sent',
    "sent_at" TIMESTAMP(3),
    "last_opened_at" TIMESTAMP(3),
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "responded_at" TIMESTAMP(3),
    "opted_out_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "invitees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guests" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "invitee_id" UUID,
    "full_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "attendance" "Attendance" NOT NULL,
    "party_size" INTEGER NOT NULL DEFAULT 1,
    "primary_meal" TEXT,
    "primary_dietary" TEXT,
    "dietary_tags" TEXT[],
    "extra_events" JSONB NOT NULL DEFAULT '{}',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "message" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'rsvp_form',
    "language" TEXT,
    "edit_token_hash" TEXT,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "guests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_companions" (
    "id" UUID NOT NULL,
    "guest_id" UUID NOT NULL,
    "type" "PartyMemberType" NOT NULL,
    "full_name" TEXT NOT NULL,
    "meal" TEXT,
    "dietary" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "guest_companions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seating_plans" (
    "event_id" UUID NOT NULL,
    "layout" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seating_plans_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "seating_tables" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "shape" "TableShape" NOT NULL,
    "seats" INTEGER NOT NULL,
    "note" TEXT,
    "x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "seating_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_assignments" (
    "id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "guest_id" UUID,
    "companion_id" UUID,
    "seat_index" INTEGER,

    CONSTRAINT "seat_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "segment" JSONB NOT NULL DEFAULT '{}',
    "template_key" TEXT NOT NULL,
    "subject_i18n" JSONB,
    "body_i18n" JSONB,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'scheduled',
    "stats" JSONB NOT NULL DEFAULT '{}',
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "campaign_id" UUID,
    "event_id" UUID,
    "invitee_id" UUID,
    "user_id" UUID,
    "channel" "Channel" NOT NULL,
    "to_address" TEXT NOT NULL,
    "template_key" TEXT NOT NULL,
    "provider" TEXT,
    "provider_message_id" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "idempotency_key" TEXT,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "opened_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "JobStatus" NOT NULL DEFAULT 'scheduled',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 4,
    "last_error" TEXT,
    "unique_key" TEXT,
    "locked_by" TEXT,
    "locked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_log" (
    "id" UUID NOT NULL,
    "event_id" UUID,
    "actor_type" TEXT NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "order_id" UUID,
    "display_name" TEXT NOT NULL,
    "location" TEXT,
    "rating" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_messages" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "auth_tokens_email_purpose_idx" ON "auth_tokens"("email", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "themes_key_key" ON "themes"("key");

-- CreateIndex
CREATE INDEX "checkout_drafts_updated_at_idx" ON "checkout_drafts"("updated_at");

-- CreateIndex
CREATE INDEX "checkout_drafts_email_idx" ON "checkout_drafts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "orders_number_key" ON "orders"("number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_checkout_session_id_key" ON "orders"("checkout_session_id");

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_email_idx" ON "orders"("email");

-- CreateIndex
CREATE INDEX "orders_payment_intent_id_idx" ON "orders"("payment_intent_id");

-- CreateIndex
CREATE INDEX "events_production_stage_idx" ON "events"("production_stage");

-- CreateIndex
CREATE INDEX "events_event_date_idx" ON "events"("event_date");

-- CreateIndex
CREATE INDEX "events_assigned_staff_id_idx" ON "events"("assigned_staff_id");

-- CreateIndex
CREATE INDEX "event_members_user_id_idx" ON "event_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "assets_storage_key_key" ON "assets"("storage_key");

-- CreateIndex
CREATE INDEX "assets_event_id_kind_idx" ON "assets"("event_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "revisions_event_id_round_number_key" ON "revisions"("event_id", "round_number");

-- CreateIndex
CREATE INDEX "revision_comments_revision_id_created_at_idx" ON "revision_comments"("revision_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_slug_key" ON "invitations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_custom_domain_key" ON "invitations"("custom_domain");

-- CreateIndex
CREATE INDEX "invitations_event_id_idx" ON "invitations"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_versions_invitation_id_version_key" ON "invitation_versions"("invitation_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "invitees_token_key" ON "invitees"("token");

-- CreateIndex
CREATE INDEX "invitees_event_id_status_idx" ON "invitees"("event_id", "status");

-- CreateIndex
CREATE INDEX "invitees_event_id_email_idx" ON "invitees"("event_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "guests_edit_token_hash_key" ON "guests"("edit_token_hash");

-- CreateIndex
CREATE INDEX "guests_event_id_deleted_at_submitted_at_idx" ON "guests"("event_id", "deleted_at", "submitted_at" DESC);

-- CreateIndex
CREATE INDEX "guests_event_id_attendance_idx" ON "guests"("event_id", "attendance");

-- CreateIndex
CREATE INDEX "seating_tables_event_id_idx" ON "seating_tables"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "seat_assignments_guest_id_key" ON "seat_assignments"("guest_id");

-- CreateIndex
CREATE UNIQUE INDEX "seat_assignments_companion_id_key" ON "seat_assignments"("companion_id");

-- CreateIndex
CREATE INDEX "campaigns_event_id_created_at_idx" ON "campaigns"("event_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "messages_idempotency_key_key" ON "messages"("idempotency_key");

-- CreateIndex
CREATE INDEX "messages_event_id_created_at_idx" ON "messages"("event_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "messages_status_idx" ON "messages"("status");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_unique_key_key" ON "jobs"("unique_key");

-- CreateIndex
CREATE INDEX "jobs_status_run_at_idx" ON "jobs"("status", "run_at");

-- CreateIndex
CREATE INDEX "activity_log_event_id_created_at_idx" ON "activity_log"("event_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reviews_published_created_at_idx" ON "reviews"("published", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_extras" ADD CONSTRAINT "plan_extras_plan_code_fkey" FOREIGN KEY ("plan_code") REFERENCES "plans"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_extras" ADD CONSTRAINT "plan_extras_extra_code_fkey" FOREIGN KEY ("extra_code") REFERENCES "extras"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_plan_code_fkey" FOREIGN KEY ("plan_code") REFERENCES "plans"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "themes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_plan_code_fkey" FOREIGN KEY ("plan_code") REFERENCES "plans"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_assigned_staff_id_fkey" FOREIGN KEY ("assigned_staff_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_members" ADD CONSTRAINT "event_members_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_members" ADD CONSTRAINT "event_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revisions" ADD CONSTRAINT "revisions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revision_comments" ADD CONSTRAINT "revision_comments_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revision_comments" ADD CONSTRAINT "revision_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "themes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_versions" ADD CONSTRAINT "invitation_versions_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitees" ADD CONSTRAINT "invitees_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guests" ADD CONSTRAINT "guests_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guests" ADD CONSTRAINT "guests_invitee_id_fkey" FOREIGN KEY ("invitee_id") REFERENCES "invitees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_companions" ADD CONSTRAINT "guest_companions_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seating_plans" ADD CONSTRAINT "seating_plans_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seating_tables" ADD CONSTRAINT "seating_tables_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "seating_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_companion_id_fkey" FOREIGN KEY ("companion_id") REFERENCES "guest_companions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_invitee_id_fkey" FOREIGN KEY ("invitee_id") REFERENCES "invitees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───── hand-written constraints (not expressible in Prisma schema) ─────
-- At most one open (non-completed) revision round per event.
CREATE UNIQUE INDEX "revisions_one_open_per_event" ON "revisions" ("event_id") WHERE "status" <> 'completed';
-- Seat assignment must reference exactly one of guest / companion.
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_one_target" CHECK ((("guest_id" IS NOT NULL)::int + ("companion_id" IS NOT NULL)::int) = 1);
-- Data sanity checks.
ALTER TABLE "guests" ADD CONSTRAINT "guests_party_size_range" CHECK ("party_size" BETWEEN 1 AND 20);
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "events" ADD CONSTRAINT "events_invites_sent_range" CHECK ("invites_sent_manual" BETWEEN 0 AND 100000);
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));
-- Case-insensitive lookups for guest dedupe hints.
CREATE INDEX "guests_event_lower_name" ON "guests" ("event_id", lower("full_name"));
-- Human-readable order numbers.
CREATE SEQUENCE "order_number_seq" START 1001;
