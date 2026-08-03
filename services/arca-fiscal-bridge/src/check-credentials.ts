import { loadAndValidateCredentials, loadArcaConfig } from './config.js';

try {
  const config = loadArcaConfig();
  if (config.environment === 'disabled') throw new Error('ARCA_DISABLED');
  const credentials = loadAndValidateCredentials(config);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    environment: config.environment,
    cuitMatchesCertificate: true,
    fingerprint256: credentials.fingerprint256,
    expiresAt: credentials.expiresAt,
    daysRemaining: credentials.daysRemaining,
    expiringSoon: credentials.expiringSoon,
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, code: (error as { code?: string }).code || (error as Error).message })}\n`);
  process.exitCode = 1;
}
