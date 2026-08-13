-- Task 4 — move driver_performance into workforce domain schema.
--
-- Small table (single ALTER SET SCHEMA), 4 Prisma-client callers work
-- unchanged, 1 raw-SQL caller updated in the same commit.
ALTER TABLE public.driver_performance SET SCHEMA workforce;
