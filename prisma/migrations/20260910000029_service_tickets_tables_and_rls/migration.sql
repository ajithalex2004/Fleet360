-- Move runtime DDL out of src/lib/service-tickets/access.ts and
-- src/lib/service-tickets/schema.ts.

CREATE TABLE IF NOT EXISTS tenant_ticket_types (
  tenant_id           TEXT         NOT NULL,
  ticket_type         TEXT         NOT NULL,
  enabled             BOOLEAN      NOT NULL DEFAULT TRUE,
  sla_override_hours  INTEGER,
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by_user_id  TEXT,
  PRIMARY KEY (tenant_id, ticket_type)
);
CREATE INDEX IF NOT EXISTS idx_tenant_ticket_types_tenant ON tenant_ticket_types (tenant_id);

CREATE TABLE IF NOT EXISTS service_tickets (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               TEXT         NOT NULL,
  ticket_type             TEXT         NOT NULL,
  readable_id             TEXT,
  requestor_id            TEXT         NOT NULL,
  requestor_name          TEXT,
  vehicle_id              TEXT,
  related_driver_id       TEXT,
  title                   TEXT         NOT NULL,
  description             TEXT,
  priority                TEXT         NOT NULL DEFAULT 'Medium',
  status                  TEXT         NOT NULL DEFAULT 'Pending',
  due_date                DATE,
  assigned_to             TEXT,
  maintenance_request_id  TEXT,
  history                 JSONB        NOT NULL DEFAULT '[]'::jsonb,
  attachments             JSONB        NOT NULL DEFAULT '[]'::jsonb,
  comments                JSONB        NOT NULL DEFAULT '[]'::jsonb,
  custom_fields           JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ
);
ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_service_tickets_tenant ON service_tickets (tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_tickets_type   ON service_tickets (tenant_id, ticket_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_tickets_status ON service_tickets (tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_tickets_readable_id ON service_tickets (readable_id) WHERE readable_id IS NOT NULL;

DO $$
DECLARE
  coltype   text;
  nullable  text;
  nulls     bigint;
  expr      text;
  done      int := 0;
  targets   text[][] := ARRAY[
    ARRAY['public', 'tenant_ticket_types'],
    ARRAY['public', 'service_tickets']
  ];
  i int;
  sch text;
  tbl text;
BEGIN
  FOR i IN 1 .. array_length(targets, 1) LOOP
    sch := targets[i][1];
    tbl := targets[i][2];

    IF to_regclass(quote_ident(sch) || '.' || quote_ident(tbl)) IS NULL THEN
      RAISE NOTICE 'SKIP %.% — does not exist', sch, tbl;
      CONTINUE;
    END IF;

    SELECT data_type, is_nullable INTO coltype, nullable
      FROM information_schema.columns
     WHERE table_schema = sch AND table_name = tbl AND column_name = 'tenant_id';

    IF coltype IS NULL THEN
      RAISE NOTICE 'SKIP %.% — no tenant_id column', sch, tbl;
      CONTINUE;
    END IF;

    EXECUTE format('SELECT count(*) FROM %I.%I WHERE tenant_id IS NULL', sch, tbl) INTO nulls;

    IF nullable = 'YES' AND nulls = 0 THEN
      EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN tenant_id SET NOT NULL', sch, tbl);
    ELSIF nulls > 0 THEN
      RAISE NOTICE '%.% has % NULL-tenant row(s) — column left nullable, rows become platform-only', sch, tbl, nulls;
    END IF;

    IF coltype = 'uuid' THEN
      expr := '(current_setting(''app.tenant_id'', true) = ''*'')'
           || ' OR ((tenant_id)::text = current_setting(''app.tenant_id'', true))';
    ELSE
      expr := '(current_setting(''app.tenant_id'', true) = ''*'')'
           || ' OR (tenant_id = current_setting(''app.tenant_id'', true))';
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', sch, tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I.%I FOR ALL USING (%s) WITH CHECK (%s)',
      sch, tbl, expr, expr);

    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', sch, tbl);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', sch, tbl);

    done := done + 1;
    RAISE NOTICE 'RLS enabled on %.% (tenant_id %, % rows had NULL)', sch, tbl, coltype, nulls;
  END LOOP;

  RAISE NOTICE 'enabled RLS on % of % tables', done, array_length(targets, 1);
END $$;
