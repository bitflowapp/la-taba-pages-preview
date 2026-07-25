// Plantilla pública para staging. Copiar como runtime-config.js en el artefacto
// de staging y reemplazar únicamente valores públicos aprobados.
globalThis.__LA_TABA_RUNTIME_CONFIG__ = Object.freeze({
  mode: 'production',
  repository: Object.freeze({
    provider: 'supabase',
    deploymentEnvironment: 'staging',
    supabaseUrl: 'https://PROJECT_REF.supabase.co',
    publishableKey: 'sb_publishable_REEMPLAZAR',
    businessId: '00000000-0000-4000-8000-000000000000',
    pollMs: 5000,
  }),
});
