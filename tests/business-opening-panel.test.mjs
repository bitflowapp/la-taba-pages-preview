// Panel: preparar apertura, equipo, fotos en lote, impresora, abrir/pausar/cerrar
// y «Horarios y cobertura». Sin navegador: un DOM mínimo alcanza para los clics.
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  configureBusinessOperations, handleBusinessOperationsAction, renderBusinessOperations,
  resetBusinessOperationsForTests, whatsappFailureMessage,
} from '../js/business/business-operations-center.js';
import { renderStoreOpeningSurface } from '../js/business/business-store-opening.js';
import {
  canAdministerMember, grantableRoles, invitationLink, invitationMessage, renderTeamSurface, validateInvitationDraft,
} from '../js/business/business-team.js';
import { planPhotoIntake, skuFromPhotoName, summarizePhotoPlan } from '../js/business/business-photo-intake.js';
import { renderPrintAgentSurface } from '../js/business/business-print-agent.js';
import { renderDayOpenSurface, renderOperationsConfigSurface } from '../js/business/business-panel-render.js';
import { normalizeOperationsConfig, pickupHoursDiffer } from '../js/business/business-operations-config.js';
import { catalogPublicationReadiness, normalizeCatalogProduct, renderCatalogEditor } from '../js/business/business-catalog-editor.js';
import { containsForbiddenVocabulary } from '../js/business/business-operation-language.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const TOKEN = 'ab'.repeat(32);

afterEach(() => resetBusinessOperationsForTests());

function dataset(attrs) {
  return Object.fromEntries(Object.entries(attrs).map(([key, value]) => [
    key.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value,
  ]));
}

/** Un botón con sus atributos, adentro de una raíz con campos y contenedores. */
function click(attrs, { fields = {}, containers = {} } = {}) {
  const root = { querySelector: (selector) => fields[selector] ?? null };
  const element = {
    dataset: dataset(attrs),
    closest(selector) {
      if (selector === '[data-business-ops-center]') return root;
      const match = /^\[([a-z0-9-]+)\]$/.exec(selector);
      if (!match) return null;
      if (Object.hasOwn(attrs, match[1])) return element;
      if (containers[match[1]]) return containers[match[1]];
      return null;
    },
  };
  return element;
}

const container = (fields) => ({ querySelector: (selector) => fields[selector] ?? null });

const READINESS = {
  business: { slug: 'la-taba-cp', name: 'La Taba', status: 'closed' },
  min_products: 1,
  items: [
    { code: 'FULFILLMENT_MODE', group: 'fulfillment', status: 'pending', blocking: true, facts: {} },
    { code: 'SERVICE_HOURS', group: 'fulfillment', status: 'pending', blocking: true, facts: { enforced: true, timezone_ok: true, missing_channels: ['pickup'] } },
    { code: 'CATALOG_PUBLISHED', group: 'catalog', status: 'pending', blocking: true, facts: { published: 0, ready_to_publish: 0 } },
    { code: 'PAYMENT_MANUAL', group: 'payments', status: 'pass', blocking: true, facts: {} },
    { code: 'PLATFORM_VERIFICATION', group: 'platform', status: 'pending', blocking: true, facts: {} },
    { code: 'STORE_OPEN', group: 'open', status: 'info', blocking: false, facts: { status: 'closed' } },
  ],
  pending: ['FULFILLMENT_MODE', 'SERVICE_HOURS', 'CATALOG_PUBLISHED', 'PLATFORM_VERIFICATION'],
  ready_for_platform_verification: false,
  can_open: false,
  accepting_orders: false,
};

// ── Preparar apertura ──────────────────────────────────────────────────────

test('preparar apertura: cada paso dice qué falta y lleva adonde se arregla, si el rol puede ir', () => {
  const html = renderStoreOpeningSurface({ data: READINESS, state: { phase: 'ready', message: '' }, allowedViews: ['operations-config'] });
  assert.match(html, /Faltan 3 pasos para abrir/);
  assert.match(html, /1 de 5 pasos obligatorios listos/);
  assert.match(html, /data-opening-code="SERVICE_HOURS"/);
  assert.match(html, /el retiro/);
  assert.equal((html.match(/data-business-ops-view="operations-config"/g) || []).length, 2, 'entrega y horario llevan a Horarios y cobertura');
  assert.doesNotMatch(html, /data-business-ops-view="catalog"/, 'sin permiso de catálogo no se ofrece el atajo');
  assert.match(html, /Panel › Catálogo/, 'pero sí se dice dónde se completa');
  assert.deepEqual(containsForbiddenVocabulary(html.replace(/<[^>]+>/g, ' ')), []);
});

test('preparar apertura: sin respuesta lo dice y ofrece volver a revisar', () => {
  const loading = renderStoreOpeningSurface({ data: null, state: { phase: 'loading', message: '' } });
  assert.match(loading, /Revisando qué falta para abrir/);
  const error = renderStoreOpeningSurface({ data: null, state: { phase: 'error', message: 'No pudimos leer qué falta para abrir.' } });
  assert.match(error, /role="alert"/);
  assert.match(error, /data-store-opening-refresh/);
});

test('preparar apertura: la vista del Panel pide la lista al entrar y la vuelve a pedir', async () => {
  let calls = 0;
  configureBusinessOperations({
    role: 'staff',
    getStoreOpeningReadiness: async () => { calls += 1; return { ok: true, data: READINESS }; },
    onChange() {},
  });
  renderBusinessOperations('store-opening');
  await settle();
  const html = renderBusinessOperations('store-opening');
  assert.equal(calls, 1);
  assert.match(html, /Preparar apertura/);
  const result = await handleBusinessOperationsAction(click({ 'data-store-opening-refresh': '' }));
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});

// ── Equipo ─────────────────────────────────────────────────────────────────

test('equipo: qué roles otorga cada uno, igual que el servidor', () => {
  assert.deepEqual(grantableRoles('owner'), ['owner', 'admin', 'staff', 'rider']);
  assert.deepEqual(grantableRoles('admin'), ['staff', 'rider']);
  assert.deepEqual(grantableRoles('staff'), []);
  assert.equal(canAdministerMember('admin', 'owner'), false);
  assert.equal(canAdministerMember('admin', 'rider'), true);
  assert.equal(canAdministerMember('owner', 'owner'), true);
});

test('equipo: el link lleva el token en el fragmento y sólo si tiene forma de token', () => {
  assert.equal(invitationLink(TOKEN, 'https://la-taba-commercial-pilot.pages.dev/'),
    `https://la-taba-commercial-pilot.pages.dev/cuenta/#invitacion=${TOKEN}`);
  assert.equal(invitationLink('nope', 'https://x'), '');
  assert.match(invitationMessage({ link: 'L', role: 'rider', expiresAt: '2026-10-01T12:00:00Z' }), /repartidor.*L.*Vence/s);
});

test('equipo: invitar a un dueño pide la frase escrita; un encargado no puede', () => {
  assert.equal(validateInvitationDraft({ fullName: 'Walter', email: 'w@example.com', role: 'owner' }, 'owner').ok, false);
  const ok = validateInvitationDraft({ fullName: 'Walter', email: 'W@Example.com', role: 'owner', confirmation: 'invitar dueño' }, 'owner');
  assert.equal(ok.ok, true);
  assert.equal(ok.invitation.email, 'w@example.com');
  assert.equal(ok.invitation.validFor, '2 days', 'la invitación de dueño vence antes');
  assert.equal(validateInvitationDraft({ fullName: 'X Y', email: 'x@example.com', role: 'owner', confirmation: 'INVITAR DUEÑO' }, 'admin').ok, false);
  assert.equal(validateInvitationDraft({ fullName: 'X', email: 'x@example.com', role: 'rider' }, 'owner').ok, false, 'nombre muy corto');
});

test('equipo: un encargado no ve la opción de dueño ni botones sobre dueños', () => {
  const members = [
    { user_id: 'u-owner', role: 'owner', is_active: true, full_name: 'Marco' },
    { user_id: 'u-rider', role: 'rider', is_active: true, full_name: 'Rider Uno' },
  ];
  const admin = renderTeamSurface({ role: 'admin', list: members, invites: [], state: { phase: 'ready', message: '' } });
  assert.doesNotMatch(admin, /<option value="owner"/);
  assert.doesNotMatch(admin, /data-team-member-role="u-owner"/);
  assert.match(admin, /data-team-member-role="u-rider"/);
  const owner = renderTeamSurface({ role: 'owner', operatorId: 'u-owner', list: members, invites: [], state: { phase: 'ready', message: '' } });
  assert.match(owner, /<option value="owner"/);
  assert.match(owner, /INVITAR DUEÑO/);
  assert.match(owner, /Marco \(vos\)/);
  assert.match(owner, /QUITAR DUEÑO/, 'tocar a un dueño pide la frase');
  assert.deepEqual(containsForbiddenVocabulary(owner.replace(/<[^>]+>/g, ' ')), []);
});

test('equipo: invitar muestra el link una sola vez y «Listo» lo olvida', async () => {
  const created = [];
  configureBusinessOperations({
    role: 'owner',
    operatorId: 'u-owner',
    listTeamMembers: async () => ({ ok: true, data: [{ user_id: 'u-owner', role: 'owner', is_active: true, full_name: 'Marco' }] }),
    listTeamInvitations: async () => ({ ok: true, data: [] }),
    createTeamInvitation: async (input) => {
      created.push(input);
      return { ok: true, data: { ok: true, token: TOKEN, invitation_id: 'i-1', expires_at: '2026-10-05T12:00:00Z', invited_role: 'rider' } };
    },
    onChange() {},
  });
  renderBusinessOperations('team');
  await settle();
  const fields = {
    '[name="teamInviteName"]': { value: 'Rider Nuevo' },
    '[name="teamInviteEmail"]': { value: 'rider@example.com' },
    '[name="teamInviteRole"]': { value: 'rider' },
    '[name="teamInviteConfirm"]': { value: '' },
  };
  const result = await handleBusinessOperationsAction(click({ 'data-team-invite-send': '' }, { fields }));
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(created, [{ fullName: 'Rider Nuevo', email: 'rider@example.com', role: 'rider', validFor: '7 days' }]);
  const shown = renderBusinessOperations('team');
  assert.match(shown, new RegExp(`/cuenta/#invitacion=${TOKEN}`));
  assert.match(shown, /wa\.me/);
  await handleBusinessOperationsAction(click({ 'data-team-invite-dismiss': '' }));
  assert.doesNotMatch(renderBusinessOperations('team'), new RegExp(TOKEN), 'el token no queda en pantalla');
});

test('equipo: sacarle el rol a un dueño exige la frase y el último dueño lo explica', async () => {
  const calls = [];
  configureBusinessOperations({
    role: 'owner',
    listTeamMembers: async () => ({ ok: true, data: [{ user_id: 'u-owner', role: 'owner', is_active: true, full_name: 'Marco' }] }),
    listTeamInvitations: async () => ({ ok: true, data: [] }),
    setTeamMemberRole: async (input) => { calls.push(input); return { ok: true, data: { ok: false, code: 'last_owner' } }; },
    onChange() {},
  });
  renderBusinessOperations('team');
  await settle();
  const member = container({ '[data-team-member-role-select]': { value: 'admin' }, '[name="teamOwnerConfirm"]': { value: '' } });
  const refused = await handleBusinessOperationsAction(click({ 'data-team-member-role': 'u-owner' }, { containers: { 'data-team-member': member } }));
  assert.equal(refused.ok, false);
  assert.match(refused.message, /QUITAR DUEÑO/);
  assert.equal(calls.length, 0, 'sin la frase no se llama al servidor');
  const typed = container({ '[data-team-member-role-select]': { value: 'admin' }, '[name="teamOwnerConfirm"]': { value: 'quitar dueño' } });
  const last = await handleBusinessOperationsAction(click({ 'data-team-member-role': 'u-owner' }, { containers: { 'data-team-member': typed } }));
  assert.equal(calls.length, 1);
  assert.equal(last.ok, false);
  assert.match(last.message, /no puede quedarse sin dueño/);
});

// ── Fotos en lote ──────────────────────────────────────────────────────────

test('fotos: el nombre del archivo nombra el SKU exacto', () => {
  assert.deepEqual(skuFromPhotoName('heineken-710ml__front.jpg'), { sku: 'heineken-710ml', kind: 'front' });
  assert.deepEqual(skuFromPhotoName('fotos\\canary\\Heineken-710ml.JPEG'), { sku: 'heineken-710ml', kind: 'front' });
  assert.deepEqual(skuFromPhotoName('heineken-710ml__alternate.png'), { sku: 'heineken-710ml', kind: 'alternate' });
  assert.equal(skuFromPhotoName('IMG_2034.jpg'), null);
  assert.equal(skuFromPhotoName('heineken-710ml.gif'), null);
});

test('fotos: el plan dice qué se sube y por qué no el resto, sin adivinar', () => {
  const file = (name, type = 'image/jpeg', size = 200_000) => ({ name, type, size });
  const products = [
    { id: 'p1', sku: 'coca-cola-2250ml', name: 'Coca', available: false, is_verified: false },
    { id: 'p2', sku: 'fanta-2250ml', name: 'Fanta', available: true, is_verified: true },
    { id: 'p3', sku: 'sprite-2250ml', name: 'Sprite', available: false, is_verified: false },
  ];
  const plan = planPhotoIntake([
    file('coca-cola-2250ml__front.jpg'),
    file('coca-cola-2250ml.jpg'),
    file('fanta-2250ml__front.jpg'),
    file('sprite-2250ml__front.jpg'),
    file('pepsi-2250ml__front.jpg'),
    file('coca-cola-2250ml__alternate.jpg'),
    file('grande__front.jpg', 'image/jpeg', 9_000_000),
    file('doc__front.jpg', 'application/pdf'),
  ], products, [{ product_id: 'p3', status: 'pending' }]);
  assert.deepEqual(plan.map((row) => row.status),
    ['ready', 'duplicate', 'published', 'pending_review', 'unknown_sku', 'alternate', 'too_big', 'bad_type']);
  assert.deepEqual(summarizePhotoPlan(plan), { total: 8, ready: 1, skipped: 7 });
});

test('fotos: subir en lote usa la carga de siempre, como foto propia, y no aprueba nada', async () => {
  const uploads = [];
  let approvals = 0;
  configureBusinessOperations({
    role: 'owner',
    listCatalogProducts: async () => ({ ok: true, data: [{ id: 'p1', sku: 'coca-cola-2250ml', name: 'Coca', catalog_origin: 'commercial', is_active: true }] }),
    listCatalogImageUploads: async () => ({ ok: true, data: { uploads: [] } }),
    getOperationsConfig: async () => ({ ok: true, data: {} }),
    uploadCatalogImage: async (input) => { uploads.push(input); return { ok: true }; },
    approveCatalogImageUpload: async () => { approvals += 1; return { ok: true }; },
    onChange() {},
  });
  renderBusinessOperations('catalog');
  await settle();
  await settle();
  const files = [{ name: 'coca-cola-2250ml__front.jpg', type: 'image/jpeg', size: 1000 }];
  const intake = container({ '[data-photo-intake-files]': { files } });
  const planned = await handleBusinessOperationsAction(click({ 'data-photo-intake-plan': '' }, { containers: { 'data-photo-intake': intake } }));
  assert.equal(planned.ok, true, planned.message);
  const sent = await handleBusinessOperationsAction(click({ 'data-photo-intake-upload': '' }));
  assert.equal(sent.ok, true, sent.message);
  assert.deepEqual(uploads.map((row) => [row.productId, row.sourceType, row.sourceUrl]), [['p1', 'business_owned_photo', '']]);
  assert.equal(approvals, 0);
  assert.match(renderBusinessOperations('catalog'), /Subida · pendiente de revisión/);
});

// ── Catálogo después de la primera publicación ────────────────────────────

test('catálogo: una ficha lista sin verificar se publica desde el Panel con el contrato de la planilla', async () => {
  const product = {
    id: 'p1', sku: 'coca-cola-2250ml', external_id: 'coca-cola-2250ml', name: 'Coca', catalog_origin: 'commercial', is_active: true,
    price: 4200, price_status: 'confirmed', stock: 12, available: false, is_verified: false,
    image_url: 'assets/products/coca.webp', catalog_asset_id: 'asset-1',
  };
  assert.deepEqual(catalogPublicationReadiness(normalizeCatalogProduct(product)), { ready: true, reason: '', mode: 'verify' });
  assert.equal(catalogPublicationReadiness(normalizeCatalogProduct({ ...product, is_verified: true })).mode, 'publish');
  assert.equal(catalogPublicationReadiness(normalizeCatalogProduct({ ...product, is_alcoholic: true })).ready, false);
  assert.equal(catalogPublicationReadiness(normalizeCatalogProduct({ ...product, is_alcoholic: true }), { alcoholEnabled: true }).ready, true);

  const batches = [];
  configureBusinessOperations({
    role: 'owner',
    listCatalogProducts: async () => ({ ok: true, data: [product] }),
    listCatalogImageUploads: async () => ({ ok: true, data: { uploads: [] } }),
    getOperationsConfig: async () => ({ ok: true, data: {} }),
    saveCommercialBatch: async (rows) => { batches.push(rows); return { ok: true, data: [] }; },
    onChange() {},
  });
  renderBusinessOperations('catalog');
  await settle();
  await settle();
  assert.match(renderBusinessOperations('catalog'), /Verificar ficha y publicar/);
  const result = await handleBusinessOperationsAction(click({ 'data-catalog-verify-publish': 'coca-cola-2250ml' }));
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(batches, [[{ sku: 'coca-cola-2250ml', publish: true }]]);
});

test('catálogo: volver a borrador para cambiar la foto se confirma y usa el contrato existente', async () => {
  const product = {
    id: 'p1', sku: 'coca-cola-2250ml', external_id: 'coca-cola-2250ml', name: 'Coca', catalog_origin: 'commercial', is_active: true,
    price: 4200, price_status: 'confirmed', stock: 12, available: true, is_verified: true,
    image_url: 'assets/products/coca.webp', catalog_asset_id: 'asset-1',
  };
  const reopened = [];
  configureBusinessOperations({
    role: 'owner',
    listCatalogProducts: async () => ({ ok: true, data: [product] }),
    listCatalogImageUploads: async () => ({ ok: true, data: { uploads: [] } }),
    getOperationsConfig: async () => ({ ok: true, data: {} }),
    unpublishCatalogProduct: async (externalId) => { reopened.push(externalId); return { ok: true, data: true }; },
    onChange() {},
  });
  renderBusinessOperations('catalog');
  await settle();
  await settle();
  const html = renderBusinessOperations('catalog');
  assert.match(html, /Cambiar foto o ficha/);
  assert.match(html, /Para cambiar la foto, primero volvé el producto a borrador/);
  await handleBusinessOperationsAction(click({ 'data-catalog-reopen': 'coca-cola-2250ml' }));
  assert.equal(reopened.length, 0, 'el primer clic sólo pide confirmar');
  assert.match(renderBusinessOperations('catalog'), /Sí, volver a borrador/);
  const done = await handleBusinessOperationsAction(click({ 'data-catalog-reopen': 'coca-cola-2250ml', 'data-confirmed': 'true' }));
  assert.equal(done.ok, true, done.message);
  assert.deepEqual(reopened, ['coca-cola-2250ml']);
});

test('catálogo: la carga en lote sólo se ofrece a quien maneja imágenes', () => {
  const html = renderCatalogEditor({ products: [], canManageImages: false, photoIntake: '<div data-photo-intake></div>' });
  assert.doesNotMatch(html, /data-photo-intake/);
});

// ── Impresora ─────────────────────────────────────────────────────────────

test('impresora: dice si el agente está vivo, qué impresoras ve y qué hay en cola', () => {
  const online = renderPrintAgentSurface({
    role: 'owner',
    data: {
      agent: 'ONLINE',
      devices: [{ id: 'd1', name: 'Mostrador', status: 'active', agent: 'ONLINE', agent_version: '1.0.0',
        printers: [{ name: 'Termica', status: 'READY' }, { name: 'Cocina', status: 'PAPER_OUT' }] }],
      queue: { queued: 2, in_flight: 1, needs_review: 0, failed_24h: 1 },
      settings: { auto_print_enabled: false },
    },
    status: { phase: 'ready', message: '' },
  });
  assert.match(online, /Agente: En línea/);
  assert.match(online, /Sin papel/);
  assert.match(online, /data-print-agent-revoke="d1"/);
  assert.match(online, /data-print-agent-pair/);
  assert.match(online, /no tiene firma digital/);
  const staff = renderPrintAgentSurface({ role: 'staff', data: { agent: 'NOT_REGISTERED', devices: [], queue: {} }, status: { phase: 'ready', message: '' } });
  assert.match(staff, /Sin vincular/);
  assert.match(staff, /opcional/);
  assert.doesNotMatch(staff, /data-print-agent-pair/, 'vincular es del dueño o el encargado');
});

// ── Abrir, pausar, reanudar, cerrar ────────────────────────────────────────

test('abrir el negocio: cada estado ofrece lo que corresponde y cerrar se confirma', () => {
  const buttons = (html) => [...html.matchAll(/data-business-open-state="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(buttons(renderDayOpenSurface({ businessStatus: 'closed', role: 'owner' })), ['open']);
  const paused = renderDayOpenSurface({ businessStatus: 'paused', role: 'owner' });
  assert.deepEqual(buttons(paused), ['open', 'closed']);
  assert.match(paused, /Reanudar pedidos/);
  assert.deepEqual(buttons(renderDayOpenSurface({ businessStatus: 'open', role: 'owner' })), ['paused', 'closed']);
  assert.deepEqual(buttons(renderDayOpenSurface({ businessStatus: 'open', role: 'staff' })), ['paused'], 'cerrar es del dueño o el encargado');
  const confirm = renderDayOpenSurface({ businessStatus: 'open', role: 'owner', pendingClose: true });
  assert.match(confirm, /Sí, cerrar el negocio/);
  assert.match(confirm, /data-confirmed="true"/);
  const blocked = renderDayOpenSurface({ businessStatus: 'closed', role: 'owner', verdict: { canOpen: false, headline: 'Faltan 3 pasos para abrir.' } });
  assert.match(blocked, /Todavía no se puede vender por la web/);
  assert.match(blocked, /data-business-ops-view="store-opening"/);
});

test('abrir el negocio: el primer «Cerrar» sólo pide confirmación; el segundo cierra', async () => {
  const states = [];
  configureBusinessOperations({
    role: 'owner',
    setBusinessOpenState: async (status) => { states.push(status); return { ok: true, data: { ok: true, status } }; },
    getOpeningStatus: async () => ({ ok: true, data: { business_status: 'closed' } }),
    onChange() {},
  });
  const first = await handleBusinessOperationsAction(click({ 'data-business-open-state': 'closed' }));
  assert.equal(first.ok, true);
  assert.deepEqual(states, []);
  const second = await handleBusinessOperationsAction(click({ 'data-business-open-state': 'closed', 'data-confirmed': 'true' }));
  assert.equal(second.ok, true);
  assert.deepEqual(states, ['closed']);
  assert.match(second.message, /Negocio cerrado/);
});

// ── Horarios y cobertura ───────────────────────────────────────────────────

const CONFIG = {
  can_manage: true, can_manage_contact: true, operating_timezone: 'America/Argentina/Buenos_Aires',
  hours_enforced: true, delivery_zone_enforced: true, delivery_enabled: false, pickup_enabled: true,
  address: 'Mendoza 827, Neuquén Capital', whatsapp_phone: '5492990000000', whatsapp_verified: false,
  hours: [
    { channel: 'delivery', weekday: 1, opens_at: '10:00', closes_at: '22:00' },
    { channel: 'pickup', weekday: 1, opens_at: '09:00', closes_at: '21:00' },
  ],
  zones: [], audit: [{ id: '1', scope: 'fulfillment', action: 'updated', actor_kind: 'user', after: { pickup_enabled: true, delivery_enabled: false } }],
};

test('horarios y cobertura: entrega, datos del local y el aviso de horarios distintos', () => {
  const config = normalizeOperationsConfig(CONFIG);
  assert.equal(pickupHoursDiffer(config), true);
  const html = renderOperationsConfigSurface({ config, status: { phase: 'ready' } });
  assert.match(html, /name="fulfillmentPickup" checked/);
  assert.doesNotMatch(html, /name="fulfillmentDelivery" checked/);
  assert.match(html, /value="Mendoza 827, Neuquén Capital"/);
  assert.match(html, /Sin confirmar: la tienda todavía no lo muestra/);
  assert.match(html, /El retiro tiene cargado otro horario/);
  assert.match(html, /Vale para retiro y para delivery/);
  assert.match(html, /si no hay pedido mínimo, poné 0/);
  assert.match(html, /Alguien del equipo editó retiro y delivery/);
  const staff = renderOperationsConfigSurface({ config: normalizeOperationsConfig({ ...CONFIG, can_manage_contact: false }), status: { phase: 'ready' } });
  assert.match(staff, /name="storeWhatsapp"[^>]*disabled/);
  assert.match(staff, /Lo confirma el dueño o el encargado/);
});

test('horarios y cobertura: guardar el horario escribe los dos canales en un paso', async () => {
  const saved = [];
  configureBusinessOperations({
    role: 'owner',
    getOperationsConfig: async () => ({ ok: true, data: { ...CONFIG, hours: [] } }),
    setOpeningHours: async (input) => { saved.push(input); return { ok: true, data: { ok: true } }; },
    setServiceHours: async () => { throw new Error('no se usa más: guardaba sólo delivery'); },
    onChange() {},
  });
  renderBusinessOperations('operations-config');
  await settle();
  const row = container({ '[name="opensAt-1"]': { value: '10:00' }, '[name="closesAt-1"]': { value: '22:00' } });
  await handleBusinessOperationsAction(click({ 'data-operations-hours-add': '1' }, { containers: { 'data-weekday': row } }));
  const result = await handleBusinessOperationsAction(click({ 'data-operations-hours-save': '' }));
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(saved, [{ hours: [{ weekday: 1, opens_at: '10:00', closes_at: '22:00' }] }]);
  assert.match(result.message, /retiro y delivery/);
});

test('horarios y cobertura: entrega y WhatsApp se guardan con mensajes del comercio', async () => {
  const calls = [];
  configureBusinessOperations({
    role: 'owner',
    getOperationsConfig: async () => ({ ok: true, data: CONFIG }),
    setFulfillment: async (input) => { calls.push(['fulfillment', input]); return { ok: true, data: { ok: true } }; },
    setBusinessWhatsapp: async (input) => { calls.push(['whatsapp', input]); return { ok: false, message: 'WhatsApp phone must contain between 8 and 15 digits.' }; },
    onChange() {},
  });
  renderBusinessOperations('operations-config');
  await settle();
  const fulfillment = await handleBusinessOperationsAction(click({ 'data-operations-fulfillment-save': '' }, {
    fields: { '[name="fulfillmentPickup"]': { checked: true }, '[name="fulfillmentDelivery"]': { checked: false } },
  }));
  assert.equal(fulfillment.message, 'Listo: sólo retiro en el local.');
  const tooShort = await handleBusinessOperationsAction(click({ 'data-operations-whatsapp-save': '' }, {
    fields: { '[name="storeWhatsapp"]': { value: '123' }, '[name="storeWhatsappConfirm"]': { checked: true } },
  }));
  assert.equal(tooShort.ok, false);
  assert.match(tooShort.message, /entre 8 y 15 números/);
  assert.deepEqual(calls, [['fulfillment', { deliveryEnabled: false, pickupEnabled: true }]], 'lo inválido no llega al servidor');
  assert.match(whatsappFailureMessage('Only an active owner/admin can authorize the business contact channel.'), /dueño o el encargado/);
});

// ── Instaladores del equipo ────────────────────────────────────────────────

test('instaladores: sólo dueño o encargado crean el link y el agente avisa que no tiene firma', async () => {
  const { renderTeamAppBlock, handleTeamAppsAction, activateTeamApps, resetTeamApps } = await import('../js/business/business-team-apps.js');
  resetTeamApps();
  assert.match(renderTeamAppBlock('rider', { elevated: false }), /lo crea el dueño o el encargado/);
  const manifest = {
    rider: { path: 'b/rider/app.apk', file: 'app.apk', version: '0.1.3-canonical-pilot', sha256: 'f'.repeat(64) },
    agent: { path: 'b/agent/agente.msi', file: 'agente.msi', version: '0.1.0', sha256: 'e'.repeat(64) },
  };
  const links = [];
  const context = {
    readTeamAppsManifest: async () => ({ ok: true, data: manifest }),
    createTeamAppLink: async (input) => { links.push(input); return { ok: true, data: 'https://cp.example/storage/v1/object/sign/team-apps/b/rider/app.apk?token=x' }; },
    onChange() {},
  };
  await activateTeamApps(context);
  const before = renderTeamAppBlock('rider', { elevated: true });
  assert.match(before, /Versión 0\.1\.3-canonical-pilot/);
  assert.match(before, /Crear link de descarga \(7 días\)/);
  assert.match(renderTeamAppBlock('agent', { elevated: true }), /SIN firma de código/);
  const result = await handleTeamAppsAction(click({ 'data-team-app-link': 'rider' }), context);
  assert.equal(result.ok, true);
  assert.deepEqual(links, [{ path: 'b/rider/app.apk', seconds: 604800, fileName: 'app.apk' }]);
  assert.match(renderTeamAppBlock('rider', { elevated: true }), /token=x/);
  resetTeamApps();
  assert.match(renderTeamAppBlock('rider', { elevated: true, data: null }), /todavía no está cargada/);
});

test('instaladores: la herramienta sólo sube el archivo certificado', async () => {
  const { parseTeamAppArgs, assertRiderReceipt, manifestEntry, RIDER_CERTIFICATE_SHA256 } = await import('../scripts/controlled-production/publish-team-app.mjs');
  const sha = 'a'.repeat(64);
  assert.throws(() => parseTeamAppArgs(['--kind', 'rider', '--file', 'x.apk', '--expect-sha256', sha]), /recibo/);
  assert.throws(() => parseTeamAppArgs(['--kind', 'agent', '--file', 'x.apk', '--expect-sha256', sha, '--version', '0.1.0']), /\.msi/);
  assert.throws(() => parseTeamAppArgs(['--kind', 'agent', '--file', 'x.msi', '--expect-sha256', 'nope', '--version', '0.1.0']), /SHA-256/);
  assert.equal(parseTeamAppArgs(['--kind', 'agent', '--file', 'x.msi', '--expect-sha256', sha, '--version', '0.1.0']).apply, false, 'por defecto es prueba');
  const receipt = { target: 'pilot', backend: 'tkanbadcglszlcyfjvpv', packageId: 'com.lataba.rider.pilot', certificateSha256: RIDER_CERTIFICATE_SHA256,
    apkSha256: sha, versionName: '0.1.3-canonical-pilot', versionCode: 4 };
  assert.equal(assertRiderReceipt(receipt, sha), true);
  assert.throws(() => assertRiderReceipt({ ...receipt, certificateSha256: 'b'.repeat(64) }, sha), /CERTIFICATE/);
  assert.throws(() => assertRiderReceipt(receipt, 'c'.repeat(64)), /THIS_APK/);
  assert.throws(() => assertRiderReceipt({ ...receipt, backend: 'ucbtjcurawxjwjdvvcvj' }, sha), /BACKEND/);
  assert.equal(manifestEntry({ kind: 'agent', fileName: 'a.msi', sha256: sha, bytes: 1, version: '0.1.0', now: 'T' }).signed, false);
  assert.equal(manifestEntry({ kind: 'rider', fileName: 'a.apk', sha256: sha, bytes: 1, receipt, now: 'T' }).version_code, 4);
});
