import { createClient } from 'npm:@supabase/supabase-js@2';
import { createGraphSender, handleWhatsAppWebhook } from '../_shared/whatsapp-webhook-gateway.ts';

// Webhook de WhatsApp Cloud API. verify_jwt = false (config.toml) porque Meta no trae un JWT de
// Supabase: la autenticidad la da la firma X-Hub-Signature-256 con el App Secret, que el
// gateway verifica ANTES de leer el cuerpo. Todo lo fiscal lo decide la base
// (whatsapp_handle_inbound → service_request_order_invoice); esta función solo firma, parsea
// y envía.
//
// Credenciales de Meta: las carga una persona en los secretos de la función. Sin ellas la
// función no arranca (falla cerrada). La versión de la Graph API también es configuración:
// el código no la inventa.
const URL = requiredEnvironment('SUPABASE_URL');
const SERVICE_ROLE = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
const APP_SECRET = requiredEnvironment('WHATSAPP_APP_SECRET');
const VERIFY_TOKEN = requiredEnvironment('WHATSAPP_VERIFY_TOKEN');
const ACCESS_TOKEN = requiredEnvironment('WHATSAPP_ACCESS_TOKEN');
const PHONE_NUMBER_ID = requiredEnvironment('WHATSAPP_PHONE_NUMBER_ID');
const GRAPH_API_VERSION = requiredEnvironment('WHATSAPP_GRAPH_API_VERSION');
if (!/^v[0-9]{1,3}\.[0-9]{1,2}$/.test(GRAPH_API_VERSION)) throw new Error('WHATSAPP_GRAPH_API_VERSION must look like v00.0');
if (!/^[0-9]{5,32}$/.test(PHONE_NUMBER_ID)) throw new Error('WHATSAPP_PHONE_NUMBER_ID must be the numeric id from Meta');

const admin = createClient(URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

async function rpc(name: string, params: Record<string, unknown>) {
  const { data, error } = await admin.rpc(name, params);
  return { data, error: error ? { code: error.code, message: error.message } : null };
}

const send = createGraphSender({
  graphApiVersion: GRAPH_API_VERSION,
  phoneNumberId: PHONE_NUMBER_ID,
  accessToken: ACCESS_TOKEN,
  fetch: (input, init) => fetch(input, init),
  rpc,
  signArtifactUrl: async (bucket, storagePath) => {
    const signed = await admin.storage.from(bucket).createSignedUrl(storagePath, 600);
    return signed.error ? null : signed.data?.signedUrl ?? null;
  },
});

Deno.serve((request) => handleWhatsAppWebhook(request, {
  appSecret: APP_SECRET,
  verifyToken: VERIFY_TOKEN,
  phoneNumberId: PHONE_NUMBER_ID,
  rpc,
  send,
  // Un evento por línea: resultado, tipo y número enmascarado. Nunca el texto ni un token.
  log: (event) => console.log(JSON.stringify(event)),
}));

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required by whatsapp-webhook`);
  return value;
}
