// Panel › Equipo: quién trabaja en el comercio, con qué rol, y cómo se suma alguien.
// ---------------------------------------------------------------------------
// Todo pasa por las RPC de identidad que ya existían y que ninguna pantalla
// usaba (`identity_list_members`, `identity_create_invitation`,
// `identity_set_member_role`, ...). Las reglas son del servidor: un encargado
// sólo invita equipo y repartidores, sólo el dueño otorga dueño o encargado, y
// nunca queda un comercio sin dueño (`last_owner`). Esta pantalla sólo evita
// ofrecer lo que va a fallar y pide una confirmación escrita para lo que no se
// puede deshacer sin otra persona: sumar o quitar un dueño.
//
// EL LINK DE INVITACIÓN. La base devuelve el token UNA sola vez. Se muestra
// para copiarlo o mandarlo por WhatsApp y se olvida: no se guarda ni se vuelve
// a pedir. Va en el fragmento (`#invitacion=`), que el navegador no manda a
// ningún servidor, y sirve sólo para el correo invitado.
import { escapeHtml } from '../ui.js';
import { humanizeFailure } from './business-operation-language.js';

export const TEAM_ROLE_LABELS = Object.freeze({
  owner: 'Dueño',
  admin: 'Encargado',
  staff: 'Equipo',
  rider: 'Repartidor',
});

export const OWNER_INVITE_PHRASE = 'INVITAR DUEÑO';
export const OWNER_REMOVE_PHRASE = 'QUITAR DUEÑO';

const INVITATION_STATUS = Object.freeze({
  pending: ['Pendiente', 'warning'],
  accepted: ['Aceptada', 'success'],
  revoked: ['Revocada', 'neutral'],
  expired: ['Vencida', 'neutral'],
});

const INVITE_ERRORS = Object.freeze({
  invalid_email: 'Revisá el correo: no parece válido.',
  invalid_role: 'Elegí un rol válido.',
  invalid_name: 'Escribí el nombre de la persona (entre 2 y 120 caracteres).',
  role_above_actor: 'Ese rol lo invita sólo el dueño.',
  already_member: 'Esa persona ya es parte del equipo.',
  invitation_pending: 'Ya hay una invitación vigente para ese correo. Revocala para mandar otra.',
});

const MEMBER_ERRORS = Object.freeze({
  invalid_role: 'Elegí un rol válido.',
  last_owner: 'El comercio no puede quedarse sin dueño. Primero sumá otro dueño.',
  invalid_state: 'No se pudo cambiar el estado.',
  not_found: 'Esa invitación ya no existe.',
  already_accepted: 'Esa invitación ya fue aceptada.',
  role_above_actor: 'Eso lo decide el dueño.',
});

/** Qué roles puede otorgar quien mira. Espejo de la regla del servidor. */
export function grantableRoles(actorRole) {
  if (actorRole === 'owner') return ['owner', 'admin', 'staff', 'rider'];
  if (actorRole === 'admin') return ['staff', 'rider'];
  return [];
}

/** ¿Quien mira puede tocar a esta persona? Un encargado no toca dueños ni encargados. */
export function canAdministerMember(actorRole, targetRole) {
  if (actorRole === 'owner') return true;
  if (actorRole === 'admin') return ['staff', 'rider'].includes(targetRole);
  return false;
}

/** El link que recibe la persona invitada. El token viaja en el fragmento. */
export function invitationLink(token, origin = globalThis.location?.origin || '') {
  const clean = String(token || '').trim();
  if (!/^[0-9a-f]{64}$/.test(clean)) return '';
  return `${String(origin).replace(/\/+$/, '')}/cuenta/#invitacion=${clean}`;
}

export function invitationMessage({ link, role, businessName = 'La Taba', expiresAt = '' }) {
  const who = TEAM_ROLE_LABELS[role] || 'parte del equipo';
  const until = expiresAt ? ` Vence el ${formatDate(expiresAt)}.` : '';
  return `Te invito a ${businessName} como ${who.toLowerCase()}. Abrí este link con tu correo para crear tu cuenta y aceptar: ${link}${until}`;
}

/** Valida el formulario de invitación antes de mandarlo. El servidor valida lo mismo. */
export function validateInvitationDraft({ fullName = '', email = '', role = '', confirmation = '' } = {}, actorRole = '') {
  const name = String(fullName).replace(/\s+/g, ' ').trim();
  const mail = String(email).trim().toLowerCase();
  if (name.length < 2 || name.length > 120) return { ok: false, message: INVITE_ERRORS.invalid_name };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return { ok: false, message: INVITE_ERRORS.invalid_email };
  if (!grantableRoles(actorRole).includes(role)) return { ok: false, message: INVITE_ERRORS.role_above_actor };
  if (role === 'owner' && String(confirmation).trim().toUpperCase() !== OWNER_INVITE_PHRASE) {
    return { ok: false, message: `Para invitar a otro dueño escribí ${OWNER_INVITE_PHRASE}.` };
  }
  return {
    ok: true,
    invitation: { fullName: name, email: mail, role, validFor: role === 'owner' ? '2 days' : '7 days' },
  };
}

// ── Estado ───────────────────────────────────────────────────────────────────
let members = [];
let invitations = [];
let status = { phase: 'idle', message: '' };
let loadStarted = false;
let generation = 0;
let lastInvitation = null;
let busy = false;

export function resetTeam() {
  generation += 1;
  members = [];
  invitations = [];
  status = { phase: 'idle', message: '' };
  loadStarted = false;
  lastInvitation = null;
  busy = false;
}

export function activateTeam(context) {
  if (loadStarted) return null;
  loadStarted = true;
  return refreshTeam(context);
}

export async function refreshTeam(context, message = '') {
  const current = generation;
  status = { phase: 'loading', message };
  context?.onChange?.();
  const [memberResponse, invitationResponse] = await Promise.all([
    context?.listTeamMembers?.() ?? { ok: false },
    context?.listTeamInvitations?.() ?? { ok: false },
  ]);
  if (current !== generation) return { ok: false, staleContext: true };
  if (memberResponse?.ok) members = Array.isArray(memberResponse.data) ? memberResponse.data : [];
  if (invitationResponse?.ok) invitations = Array.isArray(invitationResponse.data) ? invitationResponse.data : [];
  const ok = Boolean(memberResponse?.ok && invitationResponse?.ok);
  status = ok
    ? { phase: 'ready', message }
    : { phase: 'error', message: humanizeFailure(memberResponse?.message || invitationResponse?.message, 'No pudimos leer el equipo.') };
  context?.onChange?.();
  return { ok };
}

function done(ok, message) { return { handled: true, ok, message }; }

export async function handleTeamAction(target, context) {
  if (!target?.closest) return null;
  const root = target.closest('[data-business-ops-center]');
  if (target.closest('[data-team-refresh]')) {
    const response = await refreshTeam(context);
    return done(Boolean(response.ok), response.ok ? 'Equipo actualizado.' : status.message);
  }
  if (target.closest('[data-team-invite-dismiss]')) {
    lastInvitation = null;
    context?.onChange?.();
    return done(true, 'El link ya no se muestra. Si se perdió, revocalo e invitá de nuevo.');
  }
  if (target.closest('[data-team-invite-copy]')) {
    if (!lastInvitation?.link) return done(false, 'No hay un link para copiar.');
    try {
      await globalThis.navigator?.clipboard?.writeText(lastInvitation.link);
      return done(true, 'Link copiado.');
    } catch (_) {
      return done(false, 'No se pudo copiar: seleccioná el link y copialo a mano.');
    }
  }
  if (target.closest('[data-team-invite-send]')) {
    if (busy) return done(false, 'Ya hay algo en curso.');
    const draft = {
      fullName: root?.querySelector('[name="teamInviteName"]')?.value,
      email: root?.querySelector('[name="teamInviteEmail"]')?.value,
      role: root?.querySelector('[name="teamInviteRole"]')?.value,
      confirmation: root?.querySelector('[name="teamInviteConfirm"]')?.value,
    };
    const validation = validateInvitationDraft(draft, context?.role);
    if (!validation.ok) return done(false, validation.message);
    busy = true;
    const response = await context.createTeamInvitation(validation.invitation);
    busy = false;
    const data = response?.data;
    if (!response?.ok || data?.ok !== true) {
      const message = INVITE_ERRORS[data?.code] || humanizeFailure(response?.message, 'No se pudo crear la invitación.');
      status = { phase: 'ready', message };
      context?.onChange?.();
      return done(false, message);
    }
    const link = invitationLink(data.token);
    lastInvitation = {
      link,
      email: validation.invitation.email,
      role: data.invited_role || validation.invitation.role,
      expiresAt: data.expires_at || '',
      message: invitationMessage({ link, role: data.invited_role || validation.invitation.role, expiresAt: data.expires_at || '' }),
    };
    await refreshTeam(context, `Invitación creada para ${validation.invitation.email}. Mandale el link.`);
    return done(true, 'Invitación creada. Mandale el link a la persona.');
  }
  const revoke = target.closest('[data-team-invitation-revoke]');
  if (revoke) {
    if (busy) return done(false, 'Ya hay algo en curso.');
    busy = true;
    const response = await context.revokeTeamInvitation(revoke.dataset.teamInvitationRevoke);
    busy = false;
    const code = response?.data?.code;
    const ok = Boolean(response?.ok && response.data?.ok);
    const message = ok ? 'Invitación revocada: el link ya no sirve.' : MEMBER_ERRORS[code] || humanizeFailure(response?.message, 'No se pudo revocar.');
    if (ok && lastInvitation) lastInvitation = null;
    await refreshTeam(context, message);
    return done(ok, message);
  }
  const roleButton = target.closest('[data-team-member-role]');
  if (roleButton) {
    const userId = roleButton.dataset.teamMemberRole;
    const card = roleButton.closest('[data-team-member]');
    const role = card?.querySelector('[data-team-member-role-select]')?.value || '';
    const member = members.find((row) => row.user_id === userId);
    if (!member) return done(false, 'Esa persona ya no está en la lista. Actualizá.');
    if (member.role === 'owner' && role !== 'owner') {
      const typed = card?.querySelector('[name="teamOwnerConfirm"]')?.value || '';
      if (typed.trim().toUpperCase() !== OWNER_REMOVE_PHRASE) {
        return done(false, `Para sacarle el rol de dueño escribí ${OWNER_REMOVE_PHRASE}.`);
      }
    }
    if (busy) return done(false, 'Ya hay algo en curso.');
    busy = true;
    const response = await context.setTeamMemberRole({ userId, role });
    busy = false;
    const code = response?.data?.code;
    const ok = Boolean(response?.ok && response.data?.ok);
    const message = ok
      ? (code === 'unchanged' ? 'Ya tenía ese rol.' : `Rol cambiado a ${TEAM_ROLE_LABELS[role] || role}. Sus sesiones se cerraron.`)
      : MEMBER_ERRORS[code] || humanizeFailure(response?.message, 'No se pudo cambiar el rol.');
    await refreshTeam(context, message);
    return done(ok, message);
  }
  const activeButton = target.closest('[data-team-member-active]');
  if (activeButton) {
    const userId = activeButton.dataset.teamMemberActive;
    const active = activeButton.dataset.active === 'true';
    const member = members.find((row) => row.user_id === userId);
    if (!member) return done(false, 'Esa persona ya no está en la lista. Actualizá.');
    if (!active && member.role === 'owner') {
      const typed = activeButton.closest('[data-team-member]')?.querySelector('[name="teamOwnerConfirm"]')?.value || '';
      if (typed.trim().toUpperCase() !== OWNER_REMOVE_PHRASE) {
        return done(false, `Para desactivar a un dueño escribí ${OWNER_REMOVE_PHRASE}.`);
      }
    }
    if (busy) return done(false, 'Ya hay algo en curso.');
    busy = true;
    const response = await context.setTeamMemberActive({ userId, active, reason: active ? null : 'Desactivado desde el Panel' });
    busy = false;
    const code = response?.data?.code;
    const ok = Boolean(response?.ok && response.data?.ok);
    const message = ok
      ? (active ? 'Reactivado: ya puede volver a entrar.' : 'Desactivado: sus sesiones se cerraron y no puede entrar.')
      : MEMBER_ERRORS[code] || humanizeFailure(response?.message, 'No se pudo cambiar el estado.');
    await refreshTeam(context, message);
    return done(ok, message);
  }
  return null;
}

// ── Pantalla ─────────────────────────────────────────────────────────────────
export function renderTeamSurface({ role = '', operatorId = '', state = status, list = members, invites = invitations,
  invitation = lastInvitation, allowedViews = [] } = {}) {
  const grantable = grantableRoles(role);
  const memberCards = list.length
    ? list.map((member) => renderMember(member, { role, operatorId })).join('')
    : `<p class="form-hint">${state.phase === 'loading' ? 'Leyendo el equipo…' : 'Todavía no hay nadie en el equipo.'}</p>`;
  const invitationRows = invites.length
    ? invites.slice(0, 30).map((row) => renderInvitation(row, role)).join('')
    : '<p class="form-hint">Todavía no se mandó ninguna invitación.</p>';
  const inbox = allowedViews.includes('team-access')
    ? '<p class="form-hint">¿Alguien creó su cuenta y pidió entrar? <button class="text-button" type="button" data-business-ops-view="team-access">Ver solicitudes de acceso</button></p>'
    : '';

  return `<section class="business-ops-panel business-team">
    <header><div><p class="eyebrow">Panel del negocio</p><h2>Equipo</h2>
      <p>Quién trabaja en el comercio y con qué rol. Para sumar a alguien, invitalo.</p></div></header>
    ${state.message ? `<p class="business-ops-feedback" role="status">${escapeHtml(state.message)}</p>` : ''}
    ${invitation ? renderInvitationLink(invitation) : ''}

    <section class="business-config-block" data-team-invite>
      <h3>Invitar</h3>
      ${grantable.length ? `
      <div class="catalog-form-grid team-invite-form">
        <label>Nombre y apellido<input type="text" name="teamInviteName" maxlength="120" autocomplete="off"></label>
        <label>Correo<input type="email" name="teamInviteEmail" maxlength="254" autocomplete="off" inputmode="email"></label>
        <label>Rol<select name="teamInviteRole">
          ${grantable.map((value) => `<option value="${value}" ${value === 'rider' ? 'selected' : ''}>${escapeHtml(TEAM_ROLE_LABELS[value])}</option>`).join('')}
        </select></label>
        ${grantable.includes('owner') ? `<label>Si invitás a otro dueño, escribí ${OWNER_INVITE_PHRASE}<input type="text" name="teamInviteConfirm" maxlength="24" autocomplete="off"></label>` : ''}
      </div>
      <p class="form-hint">La persona recibe un link para crear su cuenta con ESE correo y aceptar. Un repartidor después entra con ese correo en la app de repartidor. Invitar a otro dueño le da el mismo control que vos: usalo para el dueño comercial.</p>
      <button class="primary-button compact" type="button" data-team-invite-send>Crear invitación</button>`
    : '<p class="form-hint">Invitar gente lo hace el dueño o el encargado.</p>'}
    </section>

    <section class="business-config-block" data-team-members>
      <h3>Personas</h3>
      <div class="team-member-list">${memberCards}</div>
    </section>

    <section class="business-config-block" data-team-invitations>
      <h3>Invitaciones</h3>
      <div class="team-invitation-list">${invitationRows}</div>
    </section>
    ${inbox}
    <div class="button-row"><button class="secondary-button compact" type="button" data-team-refresh ${state.phase === 'loading' ? 'disabled' : ''}>Actualizar</button></div>
  </section>`;
}

function renderInvitationLink(invitation) {
  const wa = `https://wa.me/?text=${encodeURIComponent(invitation.message)}`;
  return `<section class="business-config-block team-invite-link" data-team-invite-link role="status">
    <h3>Link para ${escapeHtml(invitation.email)} (${escapeHtml(TEAM_ROLE_LABELS[invitation.role] || invitation.role)})</h3>
    <input type="text" readonly value="${escapeHtml(invitation.link)}" aria-label="Link de invitación" data-team-invite-link-value>
    <div class="button-row">
      <button class="primary-button compact" type="button" data-team-invite-copy>Copiar link</button>
      <a class="secondary-button compact" href="${escapeHtml(wa)}" target="_blank" rel="noopener noreferrer">Mandar por WhatsApp</a>
      <button class="ghost-button compact" type="button" data-team-invite-dismiss>Listo, ya lo mandé</button>
    </div>
    <p class="form-hint">Sirve una sola vez, sólo para ese correo${invitation.expiresAt ? `, y vence el ${escapeHtml(formatDate(invitation.expiresAt))}` : ''}. No se vuelve a mostrar: si se pierde, revocá la invitación y creá otra.</p>
  </section>`;
}

function renderMember(member, { role, operatorId }) {
  const targetRole = String(member.role || '');
  const isSelf = operatorId && member.user_id === operatorId;
  const manageable = canAdministerMember(role, targetRole);
  const options = grantableRoles(role)
    .filter((value) => role === 'owner' || ['staff', 'rider'].includes(value))
    .map((value) => `<option value="${value}" ${value === targetRole ? 'selected' : ''}>${escapeHtml(TEAM_ROLE_LABELS[value])}</option>`)
    .join('');
  const active = member.is_active === true && !member.disabled_at;
  return `<article class="access-request-card team-member-card tone-${active ? 'success' : 'danger'}" data-team-member="${escapeHtml(member.user_id)}">
    <header>
      <div><strong>${escapeHtml(member.full_name || 'Sin nombre')}${isSelf ? ' (vos)' : ''}</strong>
        <span class="access-request-kind">${escapeHtml(TEAM_ROLE_LABELS[targetRole] || targetRole)}</span></div>
      <span class="access-request-status tone-${active ? 'success' : 'danger'}">${active ? 'Activo' : 'Desactivado'}</span>
    </header>
    <dl class="access-request-facts">
      <div><dt>Sesiones abiertas</dt><dd>${Number(member.active_sessions || 0)}</dd></div>
      ${member.member_since ? `<div><dt>Desde</dt><dd>${escapeHtml(formatDate(member.member_since))}</dd></div>` : ''}
    </dl>
    ${manageable ? `<div class="access-request-actions team-member-actions">
      <label class="access-request-role">Rol<select data-team-member-role-select>${options}</select></label>
      <button class="secondary-button" type="button" data-team-member-role="${escapeHtml(member.user_id)}">Cambiar rol</button>
      <button class="ghost-button" type="button" data-team-member-active="${escapeHtml(member.user_id)}" data-active="${active ? 'false' : 'true'}">${active ? 'Desactivar' : 'Reactivar'}</button>
      ${targetRole === 'owner' ? `<label class="access-request-role">Para quitar o desactivar un dueño, escribí ${OWNER_REMOVE_PHRASE}<input type="text" name="teamOwnerConfirm" maxlength="24" autocomplete="off"></label>` : ''}
    </div>
    ${isSelf ? '<p class="form-hint">Si cambiás tu propio rol se cierra tu sesión y entrás de nuevo con los permisos nuevos.</p>' : ''}` : ''}
  </article>`;
}

function renderInvitation(row, role) {
  const [label, tone] = INVITATION_STATUS[row.status] || INVITATION_STATUS.pending;
  const revocable = row.status === 'pending' && canAdministerMember(role, row.invited_role);
  return `<article class="team-invitation" data-team-invitation="${escapeHtml(row.invitation_id)}">
    <div><strong>${escapeHtml(row.full_name || row.invited_email)}</strong>
      <small>${escapeHtml(row.invited_email)} · ${escapeHtml(TEAM_ROLE_LABELS[row.invited_role] || row.invited_role)}</small>
      <small>${row.status === 'pending' ? `Vence el ${escapeHtml(formatDate(row.expires_at))}` : `Creada el ${escapeHtml(formatDate(row.created_at))}`}</small></div>
    <span class="status-pill ${tone}">${label}</span>
    ${revocable ? `<button class="text-button" type="button" data-team-invitation-revoke="${escapeHtml(row.invitation_id)}">Revocar</button>` : ''}
  </article>`;
}

function formatDate(value) {
  const date = new Date(value || 0);
  if (!value || Number.isNaN(date.getTime())) return 'sin fecha';
  try {
    return date.toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      hourCycle: 'h23', timeZone: 'America/Argentina/Buenos_Aires',
    });
  } catch (_) {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}
