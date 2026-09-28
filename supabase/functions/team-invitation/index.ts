import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import { handleTeamInvitation, type InvitationLookup } from '../_shared/team-invitation.ts';

// La persona invitada crea su cuenta desde /cuenta/#invitacion=…, sin SMTP y
// sin operador. verify_jwt = false porque todavía no tiene cuenta: presenta el
// token de la invitación (256 bits, un correo, un uso) y esta función lo
// verifica contra la base (RPC team_invitation_*, sólo service_role). Ver
// ../_shared/team-invitation.ts para el modelo de confianza.
const URL = requiredEnvironment('SUPABASE_URL');
const SERVICE_ROLE = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
const ALLOWED_ORIGINS = ['https://la-taba-commercial-pilot.pages.dev'];

const admin = createClient(URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(36));
  return btoa(String.fromCharCode(...bytes)).replace(/[^A-Za-z0-9]/g, 'x');
}

Deno.serve((request) => handleTeamInvitation(request, {
  allowedOrigins: ALLOWED_ORIGINS,
  lookup: async (token) => {
    const { data, error } = await admin.rpc('team_invitation_lookup', { p_token: token });
    if (error) throw new Error('lookup failed');
    return (data || { found: false }) as InvitationLookup;
  },
  createUser: async ({ email, fullName, invitationId }) => {
    // La contraseña aleatoria se descarta: la persona elige la suya en /cuenta/
    // con la política de Auth. El correo queda confirmado porque la invitación
    // del dueño es la prueba.
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: randomPassword(),
      email_confirm: true,
      user_metadata: { taba_actor: 'team', display_name: fullName.slice(0, 80), taba_invitation_id: invitationId },
    });
    if (error) {
      if (/already|registered|exists/i.test(String(error.message || '')) || error.status === 422) return { exists: true as const };
      throw new Error('create failed');
    }
    return { userId: String(data.user?.id || '') };
  },
  recoveryTokenHash: async (email) => {
    const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email });
    const hashed = data?.properties?.hashed_token;
    if (error || !hashed) throw new Error('link failed');
    return hashed;
  },
  recordActivation: async (token, userId, created) => {
    const { error } = await admin.rpc('team_invitation_record_activation', {
      p_token: token, p_user_id: userId, p_account_created: created,
    });
    if (error) throw new Error('audit failed');
  },
  // Una línea por pedido: acción y resultado. Nunca el token ni el correo.
  log: (event) => console.log(JSON.stringify(event)),
}));

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required by team-invitation`);
  return value;
}
