// Helpers puros de la pantalla «Configuración → Mercado Pago» del panel: sin
// red ni base, para poder probarlos en Node y en Deno.

/**
 * El estado OAuth vive 10 minutos y el callback revalida la sesión del panel
 * que lo inició. Si esa sesión vence antes, un consentimiento correcto termina
 * en error; por eso se exige un margen holgado al iniciar.
 */
export const SESSION_MIN_REMAINING_MS = 12 * 60 * 1000;

/**
 * Vencimiento (en ms) del JWT del encabezado Authorization. No lo verifica: la
 * autenticidad ya la decidió Auth (`getUser`) antes de llegar acá; sólo se lee
 * `exp` para saber cuánto le queda.
 */
export function sessionExpiresAtMs(authorization: string | null | undefined): number | null {
  const token = String(authorization || '').replace(/^Bearer\s+/i, '').trim();
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4)));
    const exp = Number(payload?.exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
  } catch (_) {
    return null;
  }
}

const BLOCKING_KEYS = ['open_payments', 'refunds_in_progress', 'cancellations_in_progress', 'queued_jobs', 'open_discrepancies', 'ledger_unsynced'];

/** Lo que impide desvincular sin dejar operaciones sin poder consultarse. */
export function blockingPendingCount(pending: unknown): number {
  const source = pending && typeof pending === 'object' ? pending as Record<string, unknown> : {};
  return BLOCKING_KEYS.reduce((sum, key) => sum + Math.max(0, Math.trunc(Number(source[key]) || 0)), 0);
}

/**
 * Una verificación que falló, contada en un código que el panel traduce al
 * castellano. Nunca lleva el mensaje interno ni el nombre de una variable.
 */
export function verificationFailure(error: unknown, status: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  const code = String((error as { code?: unknown } | null)?.code || '');
  let reason = 'provider_unavailable';
  // The stored state comes first: a link that never existed is «not connected»,
  // even though the token lookup answers «reauthorization required».
  if (status === 'requires_reauthorization') reason = 'reauthorization_required';
  else if (status !== 'connected') reason = 'not_connected';
  else if (code === 'SELLER_REAUTHORIZATION_REQUIRED') reason = 'reauthorization_required';
  else if (code === 'SELLER_REFRESHING') reason = 'refreshing';
  else if (/permissions unavailable/i.test(message)) reason = 'permissions_missing';
  else if (/application mismatch/i.test(message)) reason = 'application_mismatch';
  else if (/Missing required server configuration/i.test(message)) reason = 'server_configuration_incomplete';
  else if (/backend unavailable/i.test(message)) reason = 'backend_unavailable';
  return {
    checked_at: new Date().toISOString(),
    credentials_usable: false,
    online_payments_enabled: false,
    blocking_reason: reason,
  };
}

/**
 * Apodo y correo enmascarado de la cuenta vinculada: lo que el dueño reconoce
 * para saber si autorizó la cuenta correcta (la personal o la del comercio).
 */
export function sellerAccountLabel(user: Record<string, unknown> | null | undefined): string | null {
  const nickname = String(user?.nickname || '').trim().slice(0, 60);
  const email = String(user?.email || '').trim();
  const at = email.indexOf('@');
  const masked = at > 0 && at < email.length - 1 ? `${email[0]}•••${email.slice(at)}`.slice(0, 58) : '';
  const label = [nickname, masked].filter(Boolean).join(' · ');
  return label ? label.slice(0, 120) : null;
}
