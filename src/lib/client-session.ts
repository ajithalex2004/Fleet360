'use client';

const CLIENT_SESSION_KEYS = [
  'xl_mobility_session',
  'xl_mobility_session_snapshot',
  'xl_backend_token',
];

interface ClientSessionSnapshot {
  user: {
    id: string;
    username: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    roleCode: string;
    roleName: string;
  };
  tenant: {
    id: string;
    name: string;
    code?: string | null;
    plan?: string | null;
    enabledModules: string[];
  };
  permissions?: string[];
}

export function clearClientSession() {
  for (const key of CLIENT_SESSION_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore storage access failures */
    }
  }
  try {
    window.dispatchEvent(new CustomEvent('fleet360:session-cleared'));
  } catch {
    /* ignore event dispatch failures */
  }
}

export function requestServerLogout(url = '/api/auth/logout') {
  try {
    if (navigator.sendBeacon) {
      const sent = navigator.sendBeacon(url, new Blob([], { type: 'application/json' }));
      if (sent) return;
    }
  } catch {
    /* fall back to keepalive fetch */
  }

  try {
    void fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* logout must never block navigation */
  }
}

export function setClientSession(userId: string, tenantId: string, backendToken?: string | null) {
  clearClientSession();
  localStorage.setItem('xl_mobility_session', JSON.stringify({ userId, tenantId }));
  if (backendToken) {
    localStorage.setItem('xl_backend_token', backendToken);
  }
}

export function setClientSessionSnapshot(snapshot: ClientSessionSnapshot) {
  try {
    localStorage.setItem(
      'xl_mobility_session_snapshot',
      JSON.stringify({
        user: snapshot.user,
        tenant: snapshot.tenant,
        permissions: snapshot.permissions ?? [],
        ts: Date.now(),
      }),
    );
    window.dispatchEvent(new CustomEvent('fleet360:session-updated', { detail: snapshot }));
  } catch {
    /* ignore storage access failures */
  }
}
