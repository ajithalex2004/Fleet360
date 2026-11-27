/**
 * Canonical secret-redaction and preservation rules for `platform_settings`
 * (/api/admin/platform-settings and /api/admin/test-channel).
 *
 * Ensures raw credentials (`health_alert_webhook_url`, `smtp_password`,
 * `email_api_key`, `sms_auth_token`, or any future secret/token/password key)
 * are NEVER returned in API responses or echoed into error logs, while saving
 * unrelated settings or testing a channel without re-entering credentials
 * preserves the stored secret unless explicitly cleared via `clearSecrets`.
 */

export const KNOWN_SENSITIVE_PLATFORM_SETTING_KEYS = [
  'health_alert_webhook_url',
  'smtp_password',
  'email_api_key',
  'sms_auth_token',
] as const;

const EXPLICIT_SENSITIVE_SET = new Set<string>(KNOWN_SENSITIVE_PLATFORM_SETTING_KEYS);
const SENSITIVE_KEY_PATTERN =
  /(?:^|_)(?:password|pass|passphrase|secret|secret_key|token|api_key|auth_key|private_key|webhook_url|client_secret|signing_key)(?:_v\d+)?$/i;

/** Returns true if `key` holds a secret that must never leave the server unredacted. */
export function isSensitivePlatformSettingKey(key: string): boolean {
  const normalized = (key || '').trim();
  if (!normalized) return false;
  return EXPLICIT_SENSITIVE_SET.has(normalized) || SENSITIVE_KEY_PATTERN.test(normalized);
}

export interface PlatformSettingsSecretStatus {
  webhookConfigured: boolean;
  webhookUrl: '';
  smtpPasswordConfigured: boolean;
  smtpPassword: '';
  emailApiKeyConfigured: boolean;
  emailApiKey: '';
  smsAuthTokenConfigured: boolean;
  smsAuthToken: '';
}

export interface SanitizedPlatformSettingsPayload {
  settings: Record<string, string>;
  configuredSecrets: Record<string, boolean>;
  secretStatus: PlatformSettingsSecretStatus;
}

/**
 * Redacts every sensitive key in `raw` to `''` and computes explicit presence
 * flags (`configuredSecrets` + `secretStatus`).
 */
export function sanitizePlatformSettingsResponse(
  raw: Record<string, string>,
): SanitizedPlatformSettingsPayload {
  const settings: Record<string, string> = {};
  const configuredSecrets: Record<string, boolean> = {};

  for (const knownKey of KNOWN_SENSITIVE_PLATFORM_SETTING_KEYS) {
    configuredSecrets[knownKey] = Boolean((raw[knownKey] ?? '').trim());
  }

  for (const [key, value] of Object.entries(raw)) {
    if (isSensitivePlatformSettingKey(key)) {
      settings[key] = '';
      configuredSecrets[key] = Boolean((value ?? '').trim());
    } else {
      settings[key] = value;
    }
  }

  return {
    settings,
    configuredSecrets,
    secretStatus: {
      webhookConfigured: Boolean(configuredSecrets['health_alert_webhook_url']),
      webhookUrl: '',
      smtpPasswordConfigured: Boolean(configuredSecrets['smtp_password']),
      smtpPassword: '',
      emailApiKeyConfigured: Boolean(configuredSecrets['email_api_key']),
      emailApiKey: '',
      smsAuthTokenConfigured: Boolean(configuredSecrets['sms_auth_token']),
      smsAuthToken: '',
    },
  };
}

export interface ResolvedPlatformSettingPatch {
  /** Key/value pairs safe to upsert into `platform_settings`. */
  writes: Array<[string, string]>;
  /** Supplied non-empty secret values (used strictly for error-log scrubbing). */
  suppliedSecrets: string[];
  /** True when any email/SMTP key was written or cleared (triggers SMTP cache drop). */
  touchedSmtp: boolean;
}

/**
 * Splits a `PATCH /api/admin/platform-settings` payload into safe DB writes:
 *  - Sensitive keys listed in `clearSecrets` are written as `''`.
 *  - Sensitive keys submitted as blank/whitespace are skipped so existing
 *    stored secrets are preserved.
 *  - Sensitive keys with non-empty replacement values are written trimmed.
 */
export function resolvePlatformSettingPatch(
  cleanedBody: Record<string, unknown>,
): ResolvedPlatformSettingPatch {
  const clearSet = new Set<string>();
  const rawClear = cleanedBody.clearSecrets;
  if (Array.isArray(rawClear)) {
    for (const item of rawClear) {
      if (typeof item === 'string' && isSensitivePlatformSettingKey(item)) {
        clearSet.add(item.trim());
      }
    }
  }

  const writeMap = new Map<string, string>();
  const suppliedSecrets: string[] = [];

  for (const [rawKey, rawVal] of Object.entries(cleanedBody)) {
    const key = rawKey.trim();
    if (!key || key === 'clearSecrets') continue;

    if (isSensitivePlatformSettingKey(key)) {
      if (clearSet.has(key)) {
        writeMap.set(key, '');
        continue;
      }
      if (typeof rawVal === 'string') {
        const trimmed = rawVal.trim();
        if (trimmed.length > 0) {
          writeMap.set(key, trimmed);
          suppliedSecrets.push(trimmed);
        }
      }
      // Blank or non-string sensitive value without explicit clearSecrets => preserve stored value.
      continue;
    }

    if (rawVal === undefined || rawVal === null) {
      writeMap.set(key, '');
    } else if (typeof rawVal === 'string' || typeof rawVal === 'number' || typeof rawVal === 'boolean') {
      writeMap.set(key, String(rawVal));
    }
  }

  for (const clearKey of clearSet) {
    writeMap.set(clearKey, '');
  }

  const writes = Array.from(writeMap.entries());
  const touchedSmtp = writes.some(([k]) => k.startsWith('smtp_') || k.startsWith('email_'));

  return { writes, suppliedSecrets, touchedSmtp };
}

function normalizeSmtpHost(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeSmtpPort(value: string | number | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '587';
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? String(parsed) : raw;
}

function normalizeSmtpUsername(value: string | undefined): string {
  return (value ?? '').trim();
}

function normalizeSmtpEncryption(value: string | undefined): string {
  const raw = (value ?? '').trim().toLowerCase();
  if (!raw || raw === 'starttls') return 'tls';
  return raw;
}

function normalizeSmsAccountSid(value: string | undefined): string {
  return (value ?? '').trim();
}

export type SecretBindingCheck = { ok: true } | { ok: false; error: string };

/**
 * Prevents credential-exfiltration swaps during `PATCH /api/admin/platform-settings`:
 * when a stored write-only secret (`smtp_password`, `sms_auth_token`, `email_api_key`)
 * is being preserved (neither replaced nor cleared via `clearSecrets`), callers may not
 * point its target host/port/username/account/provider elsewhere or downgrade SMTP
 * encryption to cleartext `'none'`.
 */
export function validatePlatformSettingSecretBindings(
  current: Record<string, string>,
  patch: ResolvedPlatformSettingPatch,
): SecretBindingCheck {
  const writeMap = new Map<string, string>(patch.writes);

  const hasStoredSmtpPassword = Boolean((current['smtp_password'] ?? '').trim());
  if (hasStoredSmtpPassword && !writeMap.has('smtp_password')) {
    const curHost = normalizeSmtpHost(current['smtp_host']);
    const curPort = normalizeSmtpPort(current['smtp_port']);
    const curUser = normalizeSmtpUsername(current['smtp_username']);
    const curEnc = normalizeSmtpEncryption(current['smtp_encryption']);

    const nextHost = writeMap.has('smtp_host') ? normalizeSmtpHost(writeMap.get('smtp_host')) : curHost;
    const nextPort = writeMap.has('smtp_port') ? normalizeSmtpPort(writeMap.get('smtp_port')) : curPort;
    const nextUser = writeMap.has('smtp_username') ? normalizeSmtpUsername(writeMap.get('smtp_username')) : curUser;
    const nextEnc = writeMap.has('smtp_encryption') ? normalizeSmtpEncryption(writeMap.get('smtp_encryption')) : curEnc;

    if (
      nextHost !== curHost ||
      nextPort !== curPort ||
      nextUser !== curUser ||
      nextEnc !== curEnc ||
      (writeMap.has('smtp_encryption') && nextEnc === 'none')
    ) {
      return {
        ok: false,
        error:
          'Changing SMTP host, port, username, or encryption (or disabling TLS) while an SMTP password is saved requires re-entering the SMTP password or clearing smtp_password.',
      };
    }
  }

  const hasStoredSmsToken = Boolean((current['sms_auth_token'] ?? '').trim());
  if (hasStoredSmsToken && !writeMap.has('sms_auth_token')) {
    const curSid = normalizeSmsAccountSid(current['sms_account_sid']);
    const curApiUrl = (current['sms_api_url'] ?? '').trim();
    const curProvider = (current['sms_provider'] ?? '').trim().toLowerCase();

    const nextSid = writeMap.has('sms_account_sid') ? normalizeSmsAccountSid(writeMap.get('sms_account_sid')) : curSid;
    const nextApiUrl = writeMap.has('sms_api_url') ? (writeMap.get('sms_api_url') ?? '').trim() : curApiUrl;
    const nextProvider = writeMap.has('sms_provider')
      ? (writeMap.get('sms_provider') ?? '').trim().toLowerCase()
      : curProvider;

    const providerSwapped = nextProvider !== curProvider && nextProvider !== '' && nextProvider !== 'none';
    if (nextSid !== curSid || nextApiUrl !== curApiUrl || providerSwapped) {
      return {
        ok: false,
        error:
          'Changing SMS provider, Account SID, or API URL while an SMS auth token is saved requires re-entering the auth token or clearing sms_auth_token.',
      };
    }
  }

  const hasStoredEmailApiKey = Boolean((current['email_api_key'] ?? '').trim());
  if (hasStoredEmailApiKey && !writeMap.has('email_api_key')) {
    const curProvider = (current['email_provider'] ?? '').trim().toLowerCase();
    const nextProvider = writeMap.has('email_provider')
      ? (writeMap.get('email_provider') ?? '').trim().toLowerCase()
      : curProvider;
    const providerSwapped = nextProvider !== curProvider && nextProvider !== '' && nextProvider !== 'none';
    if (providerSwapped) {
      return {
        ok: false,
        error:
          'Changing email provider while an email API key is saved requires re-entering the API key or clearing email_api_key.',
      };
    }
  }

  return { ok: true };
}

/**
 * Allows reusing the stored `smtp_password` in `/api/admin/test-channel` ONLY when
 * the request targets the exact saved TLS/SSL SMTP host, port, username, and encryption.
 */
export function canReuseStoredSmtpPassword(
  stored: Record<string, string>,
  candidate: { host: string; port: string | number; username: string; encryption: string },
): { ok: true; password: string } | { ok: false; error: string } {
  const storedPassword = (stored['smtp_password'] ?? '').trim();
  if (!storedPassword) {
    return { ok: false, error: 'SMTP Host, Username, and Password are all required.' };
  }

  const candHost = normalizeSmtpHost(candidate.host);
  const candPort = normalizeSmtpPort(candidate.port);
  const candUser = normalizeSmtpUsername(candidate.username);
  const candEnc = normalizeSmtpEncryption(candidate.encryption);

  const savedHost = normalizeSmtpHost(stored['smtp_host']);
  const savedPort = normalizeSmtpPort(stored['smtp_port']);
  const savedUser = normalizeSmtpUsername(stored['smtp_username']);
  const savedEnc = normalizeSmtpEncryption(stored['smtp_encryption']);

  if (
    !savedHost ||
    !savedUser ||
    candHost !== savedHost ||
    candPort !== savedPort ||
    candUser !== savedUser ||
    candEnc !== savedEnc ||
    candEnc === 'none'
  ) {
    return {
      ok: false,
      error:
        'Stored SMTP password can only be reused with the saved TLS/SSL SMTP host, port, username, and encryption. Re-enter the SMTP password to test new connection settings.',
    };
  }

  return { ok: true, password: storedPassword };
}

/**
 * Allows reusing the stored `sms_auth_token` in `/api/admin/test-channel` ONLY when
 * the request targets the exact saved `sms_account_sid`.
 */
export function canReuseStoredSmsAuthToken(
  stored: Record<string, string>,
  candidateSid: string,
): { ok: true; token: string } | { ok: false; error: string } {
  const storedToken = (stored['sms_auth_token'] ?? '').trim();
  if (!storedToken) {
    return { ok: false, error: 'Twilio Account SID, Auth Token, and Sender Number are required.' };
  }

  const savedSid = normalizeSmsAccountSid(stored['sms_account_sid']);
  const candSid = normalizeSmsAccountSid(candidateSid);
  if (!savedSid || candSid !== savedSid) {
    return {
      ok: false,
      error:
        'Stored SMS auth token can only be reused with the saved Account SID. Re-enter the auth token to test a different account.',
    };
  }

  return { ok: true, token: storedToken };
}

/**
 * Allows reusing the stored `email_api_key` in `/api/admin/test-channel` ONLY when
 * the request targets the exact saved `email_provider` (prevents exfiltrating a
 * saved provider key by switching providers during a channel test).
 */
export function canReuseStoredEmailApiKey(
  stored: Record<string, string>,
  candidateProvider: string,
): { ok: true; apiKey: string } | { ok: false; error: string } {
  const storedKey = (stored['email_api_key'] ?? '').trim();
  if (!storedKey) {
    return { ok: false, error: 'Email API Key is required.' };
  }

  const savedProvider = (stored['email_provider'] ?? '').trim().toLowerCase();
  const candProvider = (candidateProvider ?? '').trim().toLowerCase();
  if (
    !savedProvider ||
    savedProvider === 'none' ||
    !candProvider ||
    candProvider === 'none' ||
    candProvider !== savedProvider
  ) {
    return {
      ok: false,
      error:
        'Stored email API key can only be reused with the saved email provider. Re-enter the API key to test a new provider.',
    };
  }

  return { ok: true, apiKey: storedKey };
}

/**
 * Scrubs any known secret values (raw, URL-encoded, and base64-encoded) and
 * URL-embedded tokens from log/error strings.
 */
export function redactPlatformSettingSecrets(text: string, secrets: Iterable<string> = []): string {
  let safe = text;
  for (const secret of secrets) {
    const raw = secret || '';
    if (raw.length >= 4) {
      const b64Raw = Buffer.from(raw, 'utf8').toString('base64');
      if (b64Raw && b64Raw !== raw) {
        safe = safe.split(b64Raw).join('[REDACTED_SECRET]');
      }
    }
    const trimmed = raw.trim();
    if (trimmed.length < 4) continue;
    safe = safe.split(trimmed).join('[REDACTED_SECRET]');
    const encoded = encodeURIComponent(trimmed);
    if (encoded !== trimmed) {
      safe = safe.split(encoded).join('[REDACTED_SECRET]');
    }
    const b64Trimmed = Buffer.from(trimmed, 'utf8').toString('base64');
    if (b64Trimmed && b64Trimmed !== trimmed) {
      safe = safe.split(b64Trimmed).join('[REDACTED_SECRET]');
    }
  }
  return safe.replace(/https?:\/\/[^\s"'<>)]+/gi, '[REDACTED_URL]');
}
