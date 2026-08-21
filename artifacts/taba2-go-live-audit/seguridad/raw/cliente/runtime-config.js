/*
 * TABA — configuración de despliegue PRODUCTIVA.
 *
 * Generado por scripts/build-production-runtime-config.mjs. No editar a mano:
 * el ref, la URL y el negocio se derivan y se verifican, y el archivo escrito a
 * mano es exactamente donde entra un ref de staging.
 *
 * No contiene ningún secreto: la clave es publicable y está pensada para viajar
 * en el navegador. La autoridad sigue siendo RLS, no esta clave.
 */
globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
  mode: 'production',
  repository: {
    provider: 'supabase',
    deploymentEnvironment: 'production',
    supabaseUrl: 'https://wwcpogltfgzgkrlilbcd.supabase.co',
    publishableKey: 'sb_publishable_Du5GdM2KXGhTGVB-rNXbzw_s_b-S8SK',
    businessId: '00000000-0000-4000-8000-000000000001',
    pollMs: 5000,
  },
};
