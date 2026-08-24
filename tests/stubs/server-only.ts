// Test-only stub for the `server-only` package. In a real Next.js build,
// webpack's server/client conditions make this package throw when it's
// bundled into client code — that's the whole point of the package. Under
// Vitest there's no such bundling boundary, so the real package would just
// throw unconditionally and break every test that transitively imports a
// module marked server-only (e.g. src/lib/prisma.ts -> src/lib/rls-scope.ts).
// This alias (see vitest.config.ts) swaps it for a no-op here only.
export {};
