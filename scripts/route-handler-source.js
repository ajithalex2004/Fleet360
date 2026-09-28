/**
 * Route files export privileged write handlers wrapped for auditing:
 *
 *   async function handlePOST(req) { ... }
 *   export const POST = withAuditedAction(handlePOST);
 *
 * The route guards (check-tenant-auth.js, check-tenant-rls.js) inspect
 * `export async function POST(...) { ... }` bodies. This rewrites the
 * wrapped form back to that shape so every wrapped handler is still
 * checked, exactly as before it was wrapped.
 */
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function unwrapAuditedHandlers(content) {
  let out = content;
  for (const method of METHODS) {
    const exportLine = new RegExp(`^export\\s+const\\s+${method}\\s*=\\s*withAuditedAction\\(\\s*handle${method}\\s*\\);?[ \\t]*\\n?`, 'm');
    if (!exportLine.test(out)) continue;
    out = out.replace(exportLine, '');
    out = out.replace(new RegExp(`^async\\s+function\\s+handle${method}\\s*\\(`, 'm'), `export async function ${method}(`);
  }
  return out.replace(/^\/\/ Privileged writes are always audited \(src\/lib\/audited-action\.ts\)\.\n/m, '');
}

module.exports = { unwrapAuditedHandlers };
