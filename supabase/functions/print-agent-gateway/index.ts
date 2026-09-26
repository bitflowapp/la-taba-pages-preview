import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleGatewayRequest } from '../_shared/print-agent-gateway.ts';

// Única puerta del agente local de impresión. verify_jwt = false porque el
// agente no tiene sesión de usuario: presenta su credencial de dispositivo y
// esta función la verifica contra la base (RPC agent_*, sólo service_role).
// El service_role vive acá, del lado del servidor; nunca en la PC del local.
const URL = requiredEnvironment('SUPABASE_URL');
const SERVICE_ROLE = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');

const admin = createClient(URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

Deno.serve((request) => handleGatewayRequest(request, {
  rpc: async (name, params) => {
    const { data, error } = await admin.rpc(name, params);
    return { data, error: error ? { code: error.code, message: error.message } : null };
  },
  // Una línea por pedido: acción, dispositivo, estado y duración. Nunca la
  // credencial, el hash ni el contenido de un ticket.
  log: (event) => console.log(JSON.stringify(event)),
}));

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required by print-agent-gateway`);
  return value;
}
