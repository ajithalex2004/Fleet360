DO $$
BEGIN
  IF to_regclass('public.fuel_cards') IS NOT NULL THEN
    ALTER TABLE public.fuel_cards DROP CONSTRAINT IF EXISTS fuel_cards_card_number_key;
    DROP INDEX IF EXISTS public.fuel_cards_card_number_key;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fuel_cards_tenant_card_number
      ON public.fuel_cards (tenant_id, card_number);
  END IF;
END $$;
