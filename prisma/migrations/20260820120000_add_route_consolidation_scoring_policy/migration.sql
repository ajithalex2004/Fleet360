-- Route Consolidation scoring policy: tenant-editable, effective-dated
-- weights/reference values feeding the Stage 4 scorer.

CREATE TABLE "public"."route_consolidation_scoring_policies" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ,
    "tenant_id" TEXT NOT NULL,

    "name" TEXT NOT NULL,
    "calculation_version" TEXT NOT NULL,

    "distance_reference_km" DOUBLE PRECISION NOT NULL,
    "time_reference_minutes" DOUBLE PRECISION NOT NULL,
    "passenger_impact_reference_minutes" DOUBLE PRECISION NOT NULL,
    "detour_reference_minutes" DOUBLE PRECISION NOT NULL,
    "pce_penalty_reference" DOUBLE PRECISION NOT NULL,

    "distance_weight" DOUBLE PRECISION NOT NULL,
    "time_weight" DOUBLE PRECISION NOT NULL,
    "resource_release_weight" DOUBLE PRECISION NOT NULL,

    "passenger_impact_weight" DOUBLE PRECISION NOT NULL,
    "detour_weight" DOUBLE PRECISION NOT NULL,
    "pce_penalty_weight" DOUBLE PRECISION NOT NULL,

    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMPTZ,

    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "route_consolidation_scoring_policies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_rc_scoring_policy_tenant" ON "public"."route_consolidation_scoring_policies"("tenant_id");
CREATE INDEX "idx_rc_scoring_policy_tenant_active" ON "public"."route_consolidation_scoring_policies"("tenant_id", "is_active");
