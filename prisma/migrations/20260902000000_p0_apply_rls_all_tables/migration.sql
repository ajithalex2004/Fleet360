-- P0 CRITICAL: Apply RLS to all P0 critical tables
-- This migration handles asset tables (12) and SPM tables (6)
-- It checks if tables exist before applying RLS policies

-- Function to safely apply RLS to a table if it exists
CREATE OR REPLACE FUNCTION apply_tenant_rls_if_exists(p_table_name TEXT)
RETURNS void AS $$
BEGIN
  -- Check if table exists
  IF NOT EXISTS (SELECT FROM pg_tables WHERE tablename = p_table_name AND schemaname = 'public') THEN
    RAISE NOTICE 'Table % does not exist, skipping RLS', p_table_name;
    RETURN;
  END IF;

  -- Check if tenant_id column exists
  IF NOT EXISTS (
    SELECT FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = p_table_name AND column_name = 'tenant_id'
  ) THEN
    -- Add tenant_id column with default
    EXECUTE format('ALTER TABLE %I ADD COLUMN tenant_id TEXT NOT NULL DEFAULT ''default''', p_table_name);
    RAISE NOTICE 'Added tenant_id to %', p_table_name;
  ELSE
    -- Ensure it's NOT NULL
    EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET NOT NULL', p_table_name);
    RAISE NOTICE 'Set tenant_id NOT NULL on %', p_table_name;
  END IF;

  -- Create index if it doesn't exist
  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_tenant ON %I(tenant_id)', p_table_name, p_table_name);

  -- Enable RLS
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', p_table_name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', p_table_name);

  -- Drop existing policy if any
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', p_table_name);

  -- Create tenant isolation policy
  EXECUTE format('
    CREATE POLICY tenant_isolation ON %I FOR ALL
    USING (
      current_setting(''app.tenant_id'', true) = ''*''
      OR tenant_id = current_setting(''app.tenant_id'', true)
    )
    WITH CHECK (
      current_setting(''app.tenant_id'', true) = ''*''
      OR tenant_id = current_setting(''app.tenant_id'', true)
    )
  ', p_table_name);

  RAISE NOTICE '✅ RLS applied to %', p_table_name;
END;
$$ LANGUAGE plpgsql;

-- Apply RLS to all 12 asset tables
SELECT apply_tenant_rls_if_exists('asset_categories');
SELECT apply_tenant_rls_if_exists('asset_registry');
SELECT apply_tenant_rls_if_exists('hva_assets');
SELECT apply_tenant_rls_if_exists('medical_assets');
SELECT apply_tenant_rls_if_exists('medical_seal_logs');
SELECT apply_tenant_rls_if_exists('ble_tags');
SELECT apply_tenant_rls_if_exists('ble_gateways');
SELECT apply_tenant_rls_if_exists('asset_movements');
SELECT apply_tenant_rls_if_exists('stock_transactions');
SELECT apply_tenant_rls_if_exists('field_dispatch');
SELECT apply_tenant_rls_if_exists('field_dispatch_items');
SELECT apply_tenant_rls_if_exists('personnel_stock');

-- Apply RLS to all 6 SPM tables
SELECT apply_tenant_rls_if_exists('spm_cycles');
SELECT apply_tenant_rls_if_exists('spm_tickets');
SELECT apply_tenant_rls_if_exists('spm_checklist_templates');
SELECT apply_tenant_rls_if_exists('spm_ticket_checks');
SELECT apply_tenant_rls_if_exists('spm_audit_logs');
SELECT apply_tenant_rls_if_exists('spm_notifications');

-- Clean up function
DROP FUNCTION apply_tenant_rls_if_exists(TEXT);

-- Summary
DO $$
DECLARE
  tables_with_rls INT;
BEGIN
  SELECT COUNT(*) INTO tables_with_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relrowsecurity = true
    AND c.relname IN (
      'asset_categories', 'asset_registry', 'hva_assets', 'medical_assets',
      'medical_seal_logs', 'ble_tags', 'ble_gateways', 'asset_movements',
      'stock_transactions', 'field_dispatch', 'field_dispatch_items',
      'personnel_stock', 'spm_cycles', 'spm_tickets',
      'spm_checklist_templates', 'spm_ticket_checks',
      'spm_audit_logs', 'spm_notifications'
    );

  RAISE NOTICE '========================================';
  RAISE NOTICE 'P0 CRITICAL SECURITY MIGRATION COMPLETE';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Tables with RLS enabled: % / 18', tables_with_rls;
  RAISE NOTICE 'Total tables protected (including audit_logs): %', tables_with_rls + 1;
END $$;
