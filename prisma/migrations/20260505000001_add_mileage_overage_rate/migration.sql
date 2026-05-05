-- Add mileage_overage_rate to lease_contracts_v2 for per-contract overage billing.
-- NULL means "use platform default" (0.50 AED/km, set in code).

ALTER TABLE "lease_contracts_v2"
  ADD COLUMN IF NOT EXISTS "mileage_overage_rate" DECIMAL;
