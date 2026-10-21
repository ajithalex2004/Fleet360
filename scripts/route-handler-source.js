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

/**
 * `source` with its // and /* *\/ comments blanked out. String and template
 * literals are kept as they are, so a URL like 'https://…' is not mistaken
 * for a comment.
 */
function stripComments(source) {
  let out = '';
  let quote = null;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += next ?? ''; i++; }
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; continue; }
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 1;
      out += ' ';
      continue;
    }
    out += c;
  }
  return out;
}

module.exports = { unwrapAuditedHandlers, stripComments };
