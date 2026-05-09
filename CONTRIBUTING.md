# Contributing

Solo-dev focused. The conventions here exist to keep the codebase coherent
when other contributors join later.

## Branch strategy

```
main                    ← always deployable, protected, tagged releases
├── feat/leasing-sts    ← active customer (STS) v1.0 work
└── feat/<short-name>   ← short-lived feature branches off feat/leasing-sts
```

Rules:
- `main` is always green. CI must pass before merge. No direct pushes.
- Feature branches max 2 weeks. Rebase frequently onto the parent branch.
- Tag every customer-deployed build (`v1.0.0`, `v1.0.1`, …) plus a moving
  `customer-prod` tag pointing at the live commit.

## Commit conventions

Conventional Commits style:

```
<type>(<scope>): <short description>

<longer description>

<footer with breaking changes / co-authors>
```

Common types:
- `feat` — new user-visible capability
- `fix` — bug fix
- `chore` — tooling, build, deps, no user impact
- `refactor` — internal change, no behaviour change
- `docs` — documentation
- `db` — schema / migration changes
- `test` — adding or fixing tests

Scope is the module: `leasing`, `rac`, `fleet`, `platform`, `audit`, `env`,
`ci`, etc.

## Code style

- TypeScript everywhere. No `.js` in `src/` (test scripts in `scripts/` may
  be `.js` for portability).
- `import { x } from '@/lib/...'` — use the path alias, never relative
  `../../../`.
- Zod for all external input validation (API request bodies, env, CSV
  imports). Keep schemas next to the route they serve.
- No comments unless the *why* is non-obvious. Code should explain itself.
- No emojis in code or commit messages unless explicitly requested.

## API route patterns

### Mutations (POST/PUT/PATCH/DELETE)

Wrap with `withAudit()` so the action is logged and exceptions go to Sentry:

```ts
import { withAudit } from '@/lib/with-audit';

export const POST = withAudit(
  async (req: NextRequest) => {
    // ... validation, mutation, return NextResponse.json(...)
  },
  {
    entityType: 'LeaseContract',
    action: 'CREATE',
    extractEntity: (body) => ({ id: body?.id, name: body?.contractNumber }),
    describe: (_req, body) => `Created contract ${body?.contractNumber}`,
  },
);
```

### Validation

Always Zod-validate request bodies. Return 400 with structured details on
failure:

```ts
const parsed = mySchema.safeParse(body);
if (!parsed.success) {
  return NextResponse.json(
    { error: 'Validation failed', details: parsed.error.issues.map(...) },
    { status: 400 },
  );
}
```

### Error capture

Unexpected exceptions are caught by `withAudit`. For caught errors that
matter operationally, call `captureException` directly:

```ts
import { captureException } from '@/lib/sentry';
try { await externalApi() }
catch (err) {
  captureException(err, { context: 'leasing.invoice.zoho-export', tags: { invoiceId } });
  // handle gracefully
}
```

## Database changes

```bash
# 1. Edit prisma/schema.prisma
# 2. Generate migration
npx prisma migrate dev --name <descriptive_snake_case>
# 3. Review the generated SQL in prisma/migrations/<timestamp>_<name>/migration.sql
# 4. Commit BOTH schema.prisma and the migration directory
git add prisma/schema.prisma prisma/migrations/<new_dir>
git commit -m "db: <description>"
```

**Never** edit a migration after it's been applied to any environment.
Always create a new migration to roll forward.

## Testing

```bash
npm run test:unit         # Vitest unit tests
npm run test:integration  # Vitest integration (needs DB)
npm run test:e2e          # Playwright (needs full stack)
```

CI runs lint + typecheck + unit + build on every PR. Integration and E2E
run on a separate trigger (TBD).

## Definition of done (per PR)

- [ ] CI green
- [ ] Manual happy-path verified locally
- [ ] No new TypeScript errors (`npm run typecheck`)
- [ ] No new ESLint warnings introduced
- [ ] If schema changed: migration committed, runbook updated if needed
- [ ] If new env var added: `.env.example` and `src/lib/env.ts` updated
- [ ] If new audit-worthy mutation added: `withAudit()` applied
- [ ] If user-facing string added: EN + AR translations in
      `src/contexts/LanguageContext.tsx`

## Solo-dev safety

- Run `npm run setup-hooks` once after clone — installs the pre-commit
  hook (lint + typecheck before each commit).
- Push at end of every working session. No more 4-month uncommitted work.
- Daily commits, weekly tags.
