-- Additive sync for bus_route_variants, bus_route_variant_versions, and route_stops columns
-- Ensures local/fresh replay matches prisma/schema.prisma without dropping or mutating existing data.

CREATE TABLE IF NOT EXISTS public.bus_route_variants (
  id TEXT NOT NULL,
  created_at TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6),
  deleted_at TIMESTAMPTZ(6),
  tenant_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT,
  CONSTRAINT bus_route_variants_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_bus_route_variants_route ON public.bus_route_variants(route_id);
CREATE INDEX IF NOT EXISTS idx_bus_route_variants_tenant ON public.bus_route_variants(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bus_route_variants_deleted ON public.bus_route_variants(deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bus_route_variants_route_name ON public.bus_route_variants(route_id, name);

ALTER TABLE IF EXISTS public.bus_route_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bus_route_variants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.bus_route_variants;
CREATE POLICY tenant_isolation ON public.bus_route_variants FOR ALL
  USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)))
  WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

CREATE TABLE IF NOT EXISTS public.bus_route_variant_versions (
  id TEXT NOT NULL,
  created_at TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6),
  deleted_at TIMESTAMPTZ(6),
  tenant_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  published_at TIMESTAMPTZ(6),
  published_by TEXT,
  notes TEXT,
  CONSTRAINT bus_route_variant_versions_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_bus_route_variant_versions_variant ON public.bus_route_variant_versions(variant_id);
CREATE INDEX IF NOT EXISTS idx_bus_route_variant_versions_tenant ON public.bus_route_variant_versions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bus_route_variant_versions_status ON public.bus_route_variant_versions(status);
CREATE INDEX IF NOT EXISTS idx_bus_route_variant_versions_deleted ON public.bus_route_variant_versions(deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bus_route_variant_versions_variant_ver ON public.bus_route_variant_versions(variant_id, version_number);

ALTER TABLE IF EXISTS public.bus_route_variant_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bus_route_variant_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.bus_route_variant_versions;
CREATE POLICY tenant_isolation ON public.bus_route_variant_versions FOR ALL
  USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)))
  WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));

ALTER TABLE IF EXISTS public.route_stops
  ADD COLUMN IF NOT EXISTS place_id TEXT,
  ADD COLUMN IF NOT EXISTS variant_version_id TEXT;

CREATE INDEX IF NOT EXISTS idx_route_stops_place_id ON public.route_stops(place_id);
CREATE INDEX IF NOT EXISTS idx_route_stops_variant_version ON public.route_stops(variant_version_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bus_route_variants_route_id_fkey'
  ) THEN
    ALTER TABLE public.bus_route_variants
      ADD CONSTRAINT bus_route_variants_route_id_fkey
      FOREIGN KEY (route_id) REFERENCES public.bus_routes(id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bus_route_variant_versions_variant_id_fkey'
  ) THEN
    ALTER TABLE public.bus_route_variant_versions
      ADD CONSTRAINT bus_route_variant_versions_variant_id_fkey
      FOREIGN KEY (variant_id) REFERENCES public.bus_route_variants(id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'route_stops_place_id_fkey'
  ) THEN
    ALTER TABLE public.route_stops
      ADD CONSTRAINT route_stops_place_id_fkey
      FOREIGN KEY (place_id) REFERENCES spatial.places(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'route_stops_variant_version_id_fkey'
  ) THEN
    ALTER TABLE public.route_stops
      ADD CONSTRAINT route_stops_variant_version_id_fkey
      FOREIGN KEY (variant_version_id) REFERENCES public.bus_route_variant_versions(id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
