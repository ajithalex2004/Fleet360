-- Resolve ownership from authoritative parents. Abort on orphans; never assign a default tenant.
ALTER TABLE public.vehicle_beacons ADD COLUMN tenant_id TEXT;
ALTER TABLE public.staff_rfid_tags ADD COLUMN tenant_id TEXT;
UPDATE public.vehicle_beacons b SET tenant_id = v.tenant_id FROM public.vehicles v WHERE v.id::text = b.vehicle_id::text;
UPDATE public.staff_rfid_tags t SET tenant_id = e.tenant_id FROM workforce.employees e WHERE e.id::text = t.staff_member_id::text;
ALTER TABLE public.vehicle_beacons ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.staff_rfid_tags ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX vehicle_beacons_tenant_id_idx ON public.vehicle_beacons(tenant_id);
CREATE INDEX staff_rfid_tags_tenant_id_idx ON public.staff_rfid_tags(tenant_id);
ALTER TABLE public.vehicle_beacons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_beacons FORCE ROW LEVEL SECURITY;
ALTER TABLE public.staff_rfid_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_rfid_tags FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.vehicle_beacons
USING (tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.tenant_id', true) = '*')
WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.tenant_id', true) = '*');
CREATE POLICY tenant_isolation ON public.staff_rfid_tags
USING (tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.tenant_id', true) = '*')
WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.tenant_id', true) = '*');
-- A caller with permission to write its own row cannot attach another tenant's parent.
CREATE FUNCTION public.enforce_bus_device_parent_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'vehicle_beacons' THEN
    IF NOT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id::text = NEW.vehicle_id::text AND v.tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'Vehicle beacon parent tenant mismatch' USING ERRCODE = '23503';
    END IF;
  ELSIF TG_TABLE_NAME = 'staff_rfid_tags' THEN
    IF NOT EXISTS (SELECT 1 FROM workforce.employees e WHERE e.id::text = NEW.staff_member_id::text AND e.tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'RFID parent tenant mismatch' USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vehicle_beacons_parent_tenant BEFORE INSERT OR UPDATE ON public.vehicle_beacons
FOR EACH ROW EXECUTE FUNCTION public.enforce_bus_device_parent_tenant();
CREATE TRIGGER staff_rfid_tags_parent_tenant BEFORE INSERT OR UPDATE ON public.staff_rfid_tags
FOR EACH ROW EXECUTE FUNCTION public.enforce_bus_device_parent_tenant();
