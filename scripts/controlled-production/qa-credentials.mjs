// QA credential source. Locally: Windows Credential Manager. In CI: the
// TABA_QA_CREDENTIALS environment secret, a JSON map of the same names to
// { usuario, secreto }. QA-only identities; values are never printed.
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';

let fromEnv;
export function readQaCredential(name) {
  if (fromEnv === undefined) {
    const raw = process.env.TABA_QA_CREDENTIALS;
    fromEnv = raw ? JSON.parse(raw) : null;
  }
  if (fromEnv) {
    const entry = fromEnv[name];
    return entry?.usuario && entry?.secreto ? { usuario: entry.usuario, secreto: entry.secreto } : null;
  }
  return leerSecreto(name);
}
