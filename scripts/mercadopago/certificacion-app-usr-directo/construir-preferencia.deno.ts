/*
 * El cuerpo EXACTO que manda mercadopago-create-preference, sin credenciales.
 *
 * Recibe por stdin `{ env, preparation }` —la preparación que devolvió
 * prepare_mercadopago_preference_v2 y las tres variables de entorno de las que
 * depende el constructor— y escribe en stdout `preferenceRequest(preparation)`.
 * Reusar el constructor del Edge Function es lo que hace que la certificación
 * mida la preferencia que manda La Taba y no una copia escrita a mano.
 */
import { preferenceRequest, type PreferencePreparation } from '../../../supabase/functions/_shared/mercadopago.ts';

const PERMITIDAS = new Set(['MERCADOPAGO_ENVIRONMENT', 'SUPABASE_URL', 'TABA_CHECKOUT_BASE_URL']);
const entrada = JSON.parse(await new Response(Deno.stdin.readable).text());
for (const [nombre, valor] of Object.entries(entrada.env ?? {})) {
  if (!PERMITIDAS.has(nombre) || typeof valor !== 'string') throw new Error(`variable no permitida: ${nombre}`);
  Deno.env.set(nombre, valor);
}
console.log(JSON.stringify(preferenceRequest(entrada.preparation as PreferencePreparation)));
