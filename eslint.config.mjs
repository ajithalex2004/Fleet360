import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // scripts/ and prisma/*.js are standalone Node CommonJS tooling —
    // migration runners, seed scripts, ops utilities — invoked directly
    // via `node scripts/foo.js`, never bundled by Next.js or executed as
    // ESM. @typescript-eslint/no-require-imports exists to keep app code
    // on ESM import syntax; it's the wrong rule for this file type, not a
    // real problem with these files. Everything else (no-unused-vars,
    // no-explicit-any, etc.) still applies here.
    files: ["scripts/**/*.{js,cjs}", "tests/**/*.cjs", "prisma/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default eslintConfig;
