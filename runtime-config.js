/*
 * Configuración de despliegue de TABA.
 *
 * Este archivo se carga antes de js/app.js. El repositorio conserva una
 * configuración vacía para fallar cerrado: el despliegue debe reemplazar el
 * objeto comentado con valores públicos y verificados de su proyecto.
 *
 * globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
 *   mode: 'production',
 *   repository: {
 *     provider: 'supabase',
 *     supabaseUrl: 'https://PROJECT_REF.supabase.co',
 *     publishableKey: 'sb_publishable_...',
 *     businessId: '00000000-0000-4000-8000-000000000000',
 *     pollMs: 5000,
 *   },
 * };
 *
 * Nunca incluyas service_role, contraseñas ni secretos de servidor acá.
 */
