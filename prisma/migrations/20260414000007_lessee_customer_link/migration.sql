-- Link Lessee to Customer
ALTER TABLE "lessees" ADD COLUMN IF NOT EXISTS "customer_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "lessees_customer_id_key" ON "lessees"("customer_id");
ALTER TABLE "lessees" DROP CONSTRAINT IF EXISTS "lessee_customer_fk";
ALTER TABLE "lessees" ADD CONSTRAINT "lessee_customer_fk"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL;
