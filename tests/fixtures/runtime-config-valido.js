// Fixture: una configuración runtime legítima, para que el gate de centinelas
// tenga un control positivo. Los valores son de forma real pero no apuntan a
// ningún proyecto: la clave publicable es pública por diseño y ésta es
// inventada.
globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
  mode: 'production',
  repository: {
    provider: 'supabase',
    deploymentEnvironment: 'staging',
    supabaseUrl: 'https://ukxqbgswjlibmnjemrzd.supabase.co',
    publishableKey: 'sb_publishable_9c2f4a1e7d3b5a8e2f',
    businessId: '11111111-1111-4111-8111-111111111111',
    pollMs: 60000,
  },
};
