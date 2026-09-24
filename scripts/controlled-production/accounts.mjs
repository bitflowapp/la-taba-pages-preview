// Controlled onboarding for CONTROLLED_PRODUCTION (~30 people, 1 business,
// <= 3 riders) without public signup or certified SMTP.
//
// Rules this tool keeps:
//  - roles are granted only through the domain path: the person requests
//    access (request_business_access) and an owner/admin approves it
//    (identity_review_access_request). The only service-role membership write
//    is the FIRST owner of a new business, which has nobody to approve it;
//  - real people never receive a password from the operator: they get a
//    one-time /cuenta/ link (token_hash) and choose their own. The link is
//    copied to the clipboard, never printed, logged or written to disk;
//  - QA accounts get generated passwords stored only in Windows Credential
//    Manager;
//  - disabling revokes sessions, deactivates the membership and bans Auth
//    login. Nothing is hard-deleted: orders keep their history.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { generarContrasena, guardarSecreto, leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { loadTargetKeys } from './target-keys.mjs';

const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const BAN_FOREVER = '876000h';

export function clients(keys) {
  return {
    admin: createClient(keys.url, keys.secret, OPTIONS),
    anon: () => createClient(keys.url, keys.publishable, OPTIONS),
  };
}

export async function findUserByEmail(admin, email) {
  const wanted = String(email).trim().toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw Error(`AUTH_LIST_FAILED:${error.code || error.status}`);
    const found = data.users.find((user) => user.email?.toLowerCase() === wanted);
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
  throw Error('AUTH_LIST_TOO_LARGE');
}

// Creates a confirmed identity. Without `password` the random one is discarded:
// the person sets their own through accessLink().
export async function createAccount(admin, { email, fullName, actor = 'team', qa = false, password = null }) {
  assert.ok(EMAIL.test(email || ''), 'EMAIL_INVALID');
  assert.ok(['team', 'customer'].includes(actor), 'ACTOR_INVALID');
  const existing = await findUserByEmail(admin, email);
  if (existing) return { user: existing, created: false };
  const { data, error } = await admin.auth.admin.createUser({
    email, password: password || generarContrasena(40), email_confirm: true,
    user_metadata: { taba_actor: actor, display_name: String(fullName || '').slice(0, 80),
      ...(qa ? { taba_qa: true } : {}) },
  });
  if (error || !data?.user) throw Error(`AUTH_CREATE_FAILED:${error?.code || error?.status || 'EMPTY'}`);
  return { user: data.user, created: true };
}

// One-time link to /cuenta/, handled by js/account-action.js (verifyOtp by
// token_hash, then the person chooses a password).
export async function accessLink(admin, { email, origin, type = 'recovery' }) {
  assert.ok(['recovery', 'invite'].includes(type), 'LINK_TYPE_INVALID');
  const site = new URL(origin);
  assert.equal(site.protocol, 'https:', 'LINK_ORIGIN_HTTPS_REQUIRED');
  const { data, error } = await admin.auth.admin.generateLink({ type, email });
  const hashed = data?.properties?.hashed_token;
  if (error || !hashed) throw Error(`LINK_FAILED:${error?.code || error?.status || 'EMPTY'}`);
  return `${site.origin}/cuenta/?token_hash=${encodeURIComponent(hashed)}&type=${type}`;
}

export function copyToClipboard(text) {
  execFileSync('clip', { input: text, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
}

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw Error(`RPC_${name}:${error.code || 'ERROR'}`);
  return data;
}

export async function signIn(client, email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data?.session) throw Error(`LOGIN_FAILED:${error?.code || 'NO_SESSION'}`);
  return data.session.user;
}

// Domain path for staff/rider: the person asks, an owner/admin decides.
export async function requestAndApprove({ personClient, reviewerClient, businessId, access,
  role, fullName, phone = null }) {
  assert.ok(['panel', 'rider'].includes(access), 'ACCESS_INVALID');
  const requested = await rpc(personClient, 'request_business_access', {
    p_business_id: businessId, p_access: access, p_full_name: fullName, p_contact_phone: phone,
  });
  if (requested?.ok === false && requested.code !== 'already_member') {
    throw Error(`ACCESS_REQUEST_REFUSED:${requested.code}`);
  }
  if (requested?.code === 'already_member') return { status: 'already_member' };
  const inbox = await rpc(reviewerClient, 'identity_list_access_requests',
    { p_business_id: businessId, p_status: 'pending' });
  const personId = (await personClient.auth.getUser()).data.user.id;
  const request = (Array.isArray(inbox) ? inbox : []).find((row) => row.user_id === personId);
  assert.ok(request?.request_id, 'ACCESS_REQUEST_NOT_IN_INBOX');
  const decided = await rpc(reviewerClient, 'identity_review_access_request', {
    p_request_id: request.request_id, p_decision: 'approve', p_role: role, p_reason: 'Alta controlada',
  });
  if (!decided?.ok) throw Error(`ACCESS_APPROVAL_REFUSED:${decided?.code}`);
  return { status: decided.code || 'approved' };
}

// First owner of a brand-new business only: no owner exists yet to approve.
export async function bootstrapFirstOwner(admin, { businessId, userId, fullName }) {
  assert.ok(UUID.test(businessId) && UUID.test(userId), 'BOOTSTRAP_IDS_INVALID');
  const owners = await admin.from('business_members').select('user_id')
    .eq('business_id', businessId).eq('role', 'owner');
  if (owners.error) throw Error(`OWNER_READ:${owners.error.code}`);
  if (owners.data.length) {
    assert.ok(owners.data.some((row) => row.user_id === userId), 'BUSINESS_ALREADY_HAS_ANOTHER_OWNER');
    return { status: 'already_owner' };
  }
  const member = await admin.from('business_members')
    .insert({ business_id: businessId, user_id: userId, role: 'owner', is_active: true });
  if (member.error) throw Error(`OWNER_CREATE:${member.error.code}`);
  const security = await admin.from('identity_user_security')
    .upsert({ business_id: businessId, user_id: userId }, { onConflict: 'business_id,user_id' });
  if (security.error) throw Error(`OWNER_SECURITY:${security.error.code}`);
  const profile = await admin.from('staff_profiles')
    .upsert({ business_id: businessId, user_id: userId, full_name: fullName, created_by: userId },
      { onConflict: 'business_id,user_id' });
  if (profile.error) throw Error(`OWNER_PROFILE:${profile.error.code}`);
  return { status: 'owner_created' };
}

// Without reviewerClient this is the operator emergency path (the Panel has no
// member deactivation UI and the operator never holds the owner's password):
// membership off by service role, every Auth session deleted, login banned.
export async function disableAccount({ admin, reviewerClient, businessId, userId, reason }) {
  const result = { membership: 'none', sessions: 'none', auth: 'none' };
  const member = await admin.from('business_members').select('role,is_active')
    .eq('business_id', businessId).eq('user_id', userId).maybeSingle();
  if (member.error) throw Error(`MEMBER_READ:${member.error.code}`);
  if (!reviewerClient) {
    assert.notEqual(member.data?.role, 'owner', 'OPERATOR_PATH_NEVER_DISABLES_AN_OWNER');
    if (member.data?.is_active) {
      const off = await admin.from('business_members').update({ is_active: false })
        .eq('business_id', businessId).eq('user_id', userId);
      if (off.error) throw Error(`MEMBER_DISABLE:${off.error.code}`);
      result.membership = 'inactive';
    }
    const killed = await admin.rpc('identity_kill_auth_sessions_for_user', { p_user_id: userId });
    if (killed.error) throw Error(`SESSIONS_KILL:${killed.error.code}`);
    result.sessions = 'deleted';
    const banned = await admin.auth.admin.updateUserById(userId, { ban_duration: BAN_FOREVER });
    if (banned.error) throw Error(`AUTH_BAN_FAILED:${banned.error.code || banned.error.status}`);
    result.auth = 'banned';
    result.reason = String(reason || '').slice(0, 120);
    return result;
  }
  if (member.data?.is_active) {
    const off = await rpc(reviewerClient, 'identity_set_member_active', {
      p_business_id: businessId, p_user_id: userId, p_is_active: false, p_reason: reason,
    });
    if (!off?.ok) throw Error(`MEMBER_DISABLE_REFUSED:${off?.code}`);
    result.membership = 'inactive';
  }
  if (member.data) {
    await rpc(reviewerClient, 'identity_revoke_all_sessions', { p_business_id: businessId, p_user_id: userId });
    result.sessions = 'revoked';
  }
  const banned = await admin.auth.admin.updateUserById(userId, { ban_duration: BAN_FOREVER });
  if (banned.error) throw Error(`AUTH_BAN_FAILED:${banned.error.code || banned.error.status}`);
  result.auth = 'banned';
  return result;
}

export async function enableAccount({ admin, reviewerClient, businessId, userId, reason }) {
  const unbanned = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' });
  if (unbanned.error) throw Error(`AUTH_UNBAN_FAILED:${unbanned.error.code || unbanned.error.status}`);
  const member = await admin.from('business_members').select('is_active')
    .eq('business_id', businessId).eq('user_id', userId).maybeSingle();
  if (member.error) throw Error(`MEMBER_READ:${member.error.code}`);
  if (member.data && !member.data.is_active && !reviewerClient) {
    const on = await admin.from('business_members').update({ is_active: true })
      .eq('business_id', businessId).eq('user_id', userId);
    if (on.error) throw Error(`MEMBER_ENABLE:${on.error.code}`);
  } else if (member.data && !member.data.is_active) {
    const on = await rpc(reviewerClient, 'identity_set_member_active', {
      p_business_id: businessId, p_user_id: userId, p_is_active: true, p_reason: reason,
    });
    if (!on?.ok) throw Error(`MEMBER_ENABLE_REFUSED:${on?.code}`);
  }
  return { auth: 'active', membership: member.data ? 'active' : 'none' };
}

// QA identities for automated certification: password only in Credential Manager.
export async function ensureQaMember({ keys, businessId, reviewerClient, credentialName, email,
  fullName, access, role, phone = null }) {
  const { admin, anon } = clients(keys);
  let stored = leerSecreto(credentialName);
  const { user, created } = await createAccount(admin, { email, fullName, actor: 'team', qa: true,
    password: stored?.usuario === email ? stored.secreto : null });
  if (!created && stored?.usuario !== email) {
    assert.ok(user.user_metadata?.taba_qa === true, 'QA_EMAIL_BELONGS_TO_NON_QA_ACCOUNT');
    const password = generarContrasena(32);
    const reset = await admin.auth.admin.updateUserById(user.id, { password });
    if (reset.error) throw Error(`QA_PASSWORD_RESET:${reset.error.code}`);
    guardarSecreto(credentialName, email, password);
  } else if (created && stored?.usuario !== email) {
    const password = generarContrasena(32);
    const reset = await admin.auth.admin.updateUserById(user.id, { password });
    if (reset.error) throw Error(`QA_PASSWORD_SET:${reset.error.code}`);
    guardarSecreto(credentialName, email, password);
  }
  stored = leerSecreto(credentialName);
  await admin.auth.admin.updateUserById(user.id, { ban_duration: 'none' });
  const client = anon();
  await signIn(client, email, stored.secreto);
  const member = await admin.from('business_members').select('role,is_active')
    .eq('business_id', businessId).eq('user_id', user.id).maybeSingle();
  if (member.error) throw Error(`MEMBER_READ:${member.error.code}`);
  if (!member.data) {
    await requestAndApprove({ personClient: client, reviewerClient, businessId, access, role, fullName, phone });
  } else {
    assert.equal(member.data.role, role, 'QA_MEMBER_ROLE_MISMATCH');
    if (!member.data.is_active) {
      await enableAccount({ admin, reviewerClient, businessId, userId: user.id, reason: 'QA reactivación' });
    }
  }
  return { client, userId: user.id, email };
}

function option(args, name) {
  const at = args.indexOf(name);
  return at < 0 ? '' : args[at + 1] || '';
}

async function reviewer(keys, credentialName) {
  const stored = leerSecreto(credentialName);
  assert.ok(stored?.secreto, 'REVIEWER_CREDENTIAL_REQUIRED');
  const client = clients(keys).anon();
  await signIn(client, stored.usuario, stored.secreto);
  return client;
}

async function main(args) {
  const [command] = args;
  const target = option(args, '--target');
  assert.ok(['staging', 'controlled-production'].includes(target), 'EXPLICIT_TARGET_REQUIRED');
  const keys = await loadTargetKeys(target);
  const { admin } = clients(keys);
  const businessId = option(args, '--business-id');
  const email = option(args, '--email').trim().toLowerCase();
  const say = (value) => console.log(JSON.stringify({ target, ref: keys.ref, command, ...value }));
  switch (command) {
    case 'create-account': {
      const { user, created } = await createAccount(admin, { email, fullName: option(args, '--name'),
        actor: option(args, '--actor') || 'team' });
      return say({ userId: user.id, created, passwordShared: false });
    }
    case 'access-link': {
      const link = await accessLink(admin, { email, origin: option(args, '--origin'),
        type: option(args, '--type') || 'recovery' });
      copyToClipboard(link);
      return say({ link: 'COPIED_TO_CLIPBOARD_NOT_PRINTED' });
    }
    case 'bootstrap-owner': {
      const user = await findUserByEmail(admin, email);
      assert.ok(user, 'OWNER_ACCOUNT_REQUIRED');
      return say(await bootstrapFirstOwner(admin, { businessId, userId: user.id,
        fullName: option(args, '--name') || 'Dueño' }));
    }
    case 'disable':
    case 'enable': {
      const user = await findUserByEmail(admin, email);
      assert.ok(user, 'ACCOUNT_NOT_FOUND');
      const operator = args.includes('--operator');
      assert.ok(operator !== Boolean(option(args, '--reviewer-credential')), 'CHOOSE_--operator_OR_--reviewer-credential');
      const reviewerClient = operator ? null : await reviewer(keys, option(args, '--reviewer-credential'));
      const run = command === 'disable' ? disableAccount : enableAccount;
      return say(await run({ admin, reviewerClient, businessId, userId: user.id,
        reason: option(args, '--reason') || 'Operación controlada' }));
    }
    case 'reset-access': {
      const user = await findUserByEmail(admin, email);
      assert.ok(user, 'ACCOUNT_NOT_FOUND');
      const signedOut = await admin.auth.admin.signOut?.(user.id).catch(() => null);
      const link = await accessLink(admin, { email, origin: option(args, '--origin') });
      copyToClipboard(link);
      return say({ userId: user.id, sessions: signedOut ? 'revoke_requested' : 'unchanged',
        link: 'COPIED_TO_CLIPBOARD_NOT_PRINTED' });
    }
    case 'list': {
      const members = await admin.from('business_members').select('user_id,role,is_active')
        .eq('business_id', businessId);
      if (members.error) throw Error(`MEMBER_LIST:${members.error.code}`);
      const rows = [];
      for (const member of members.data) {
        const { data } = await admin.auth.admin.getUserById(member.user_id);
        const mail = data?.user?.email || '';
        rows.push({ role: member.role, active: member.is_active,
          email: mail.replace(/^(.).*(@.*)$/, '$1***$2'),
          banned: Boolean(data?.user?.banned_until && Date.parse(data.user.banned_until) > Date.now()) });
      }
      return say({ members: rows });
    }
    default:
      throw Error('COMMAND_REQUIRED:create-account|access-link|bootstrap-owner|disable|enable|reset-access|list');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`ACCOUNTS_BLOCKED:${error.message}`);
    process.exitCode = 1;
  });
}
