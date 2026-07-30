import { addToCart } from './cart.js';
import { getState, setState } from './state.js';
import { enableGpsTracking, pauseSimulation, startSimulation } from './simulation.js';
import { isDemoMode, isShowcaseMode } from './core/app-mode.js';
import { getOrderRepository, isSandboxOrderRepository } from './repositories/repository_factory.js';

let feedback = '';

export function isSandboxToolsEnabled() {
  if (!isDemoMode() || isShowcaseMode()) return false;
  try {
    return new URLSearchParams(globalThis.location?.search || '').get('tools') === '1';
  } catch (_) {
    return false;
  }
}
export function renderSandboxTools() {
  if (typeof document === 'undefined') return;
  const enabled = isSandboxToolsEnabled() && isSandboxOrderRepository(getOrderRepository());
  const current = document.querySelector('[data-sandbox-tools]');
  if (!enabled) {
    current?.remove();
    return;
  }
  const panel = current || document.createElement('aside');
  panel.dataset.sandboxTools = '';
  panel.className = 'sandbox-tools-panel';
  panel.setAttribute('aria-label', 'Herramientas de sandbox');
  panel.innerHTML = `
    <div class="sandbox-tools-head">
      <div><span class="eyebrow">Herramientas</span><h2>Escenario local</h2></div>
      <span class="sandbox-tools-badge">Sandbox</span>
    </div>
    <p class="sandbox-tools-copy">Usá estas acciones para recorrer cliente, negocio, rider y seguimiento en este navegador.</p>
    <div class="sandbox-tools-actions">
      <button type="button" class="secondary-button compact" data-sandbox-action="seed-order">Crear pedido</button>
      <button type="button" class="secondary-button compact" data-sandbox-action="advance">Avanzar estado</button>
      <button type="button" class="secondary-button compact" data-sandbox-action="tracking">Pausar / reanudar seguimiento</button>
      <button type="button" class="secondary-button compact" data-sandbox-action="gps">Usar GPS local</button>
      <button type="button" class="secondary-button compact" data-sandbox-action="route">Usar recorrido de muestra</button>
      <button type="button" class="ghost-button compact" data-sandbox-action="speed">Acelerar seguimiento</button>
      <button type="button" class="ghost-button compact" data-sandbox-action="reset">Reiniciar escenario</button>
      <button type="button" class="ghost-button compact" data-sandbox-action="export">Exportar JSON</button>
      <button type="button" class="ghost-button compact" data-sandbox-action="import">Importar JSON</button>
      <input type="file" accept="application/json,.json" data-sandbox-import hidden />
    </div>
    <nav class="sandbox-tools-links" aria-label="Vistas sandbox">
      <a href="?demo=1&tools=1#home">Cliente</a>
      <a href="?demo=1&tools=1#business">Negocio</a>
      <a href="?demo=1&tools=1#rider">Rider</a>
      <a href="?demo=1&tools=1#tracking">Tracking</a>
    </nav>
    <p class="sandbox-tools-status" data-sandbox-tools-status role="status">${feedback || 'Estado persistente en este navegador.'}</p>
  `;
  if (!current) document.body.appendChild(panel);
}

function currentSandboxOrder() {
  return getState().orders.find((order) => !order.internalSeed) || null;
}

async function createSandboxTestOrder() {
  const repository = getOrderRepository();
  const product = getState().products.find((candidate) => candidate.active !== false && Number(candidate.stock) > 0)
    || getState().products[0];
  if (!product) return { ok: false, message: 'No hay productos disponibles para crear el pedido.' };
  const added = addToCart(product.id, 1);
  if (!added.ok) return added;
  return repository.createOrder({
    customerName: 'Cliente Sandbox',
    customerPhone: '2995550101',
    customerAddress: 'Calle de muestra 123',
    customerStreetAddress: 'Calle de muestra 123',
    customerNeighborhood: 'Neuquén Capital',
    customerReference: 'Punto de entrega de muestra',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    customerNotes: 'Pedido de prueba',
    ageConfirmed: true,
    previewOnly: false,
  });
}

async function advanceSandboxOrder() {
  const repository = getOrderRepository();
  const order = currentSandboxOrder();
  if (!order) return { ok: false, message: 'Creá un pedido sandbox primero.' };
  if (order.status === 'received') return repository.updateOrderStatus(order.id, 'accepted');
  if (order.status === 'preparing') return repository.updateOrderStatus(order.id, 'ready');
  if (order.status === 'ready' && !order.assignedRiderId) {
    return repository.claimRiderOrder(order.id, { riderId: repository.getRiderId?.() });
  }
  if (order.status === 'ready') return repository.updateOrderStatus(order.id, 'on_the_way');
  if (order.status === 'on_the_way') return repository.updateOrderStatus(order.id, 'arriving');
  if (order.status === 'arriving') {
    const verified = repository.verifyDeliveryCode?.(order.id, order.deliveryCode?.code);
    if (!verified?.ok) return verified || { ok: false, message: 'No se pudo validar el código de entrega.' };
    return repository.updateOrderStatus(order.id, 'delivered');
  }
  return { ok: false, message: 'El pedido ya está finalizado.' };
}

function toggleSandboxTracking() {
  const simulation = getState().simulation;
  if (!simulation) return startSimulation();
  if (simulation.running) return pauseSimulation();
  return startSimulation();
}

function accelerateSandboxTracking() {
  const simulation = getState().simulation;
  if (!simulation) return { ok: false, message: 'Iniciá el seguimiento antes de acelerarlo.' };
  const speed = Math.max(1, Math.min(8, Number(simulation.speed) || 1));
  const next = speed >= 8 ? 1 : speed * 2;
  setState({ simulation: { ...simulation, speed: next } });
  return { ok: true, message: `Velocidad de seguimiento: ${next}×.` };
}

function downloadJson(payload) {
  if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof document === 'undefined') {
    return { ok: false, message: 'La exportación no está disponible en este navegador.' };
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'taba-sandbox-state.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return { ok: true, message: 'Estado sandbox exportado.' };
}

export async function handleSandboxToolsAction(target) {
  if (!isSandboxToolsEnabled()) return { handled: false };
  const action = target.closest?.('[data-sandbox-action]')?.dataset.sandboxAction;
  if (!action) return { handled: false };
  const repository = getOrderRepository();
  if (!isSandboxOrderRepository(repository)) return { handled: true, ok: false, message: 'La sandbox no está disponible.' };
  let result;
  if (action === 'seed-order') result = await createSandboxTestOrder();
  if (action === 'advance') result = await advanceSandboxOrder();
  if (action === 'tracking') result = toggleSandboxTracking();
  if (action === 'gps') result = enableGpsTracking();
  if (action === 'route') result = startSimulation();
  if (action === 'speed') result = accelerateSandboxTracking();
  if (action === 'reset') result = await repository.resetSandbox();
  if (action === 'export') result = downloadJson(await repository.exportSandboxState());
  if (action === 'import') {
    target.closest('[data-sandbox-tools]')?.querySelector('[data-sandbox-import]')?.click();
    return { handled: true, ok: true, message: '' };
  }
  feedback = result?.message || '';
  return { handled: true, ok: Boolean(result?.ok), message: result?.message || 'Acción sandbox completada.' };
}

export async function handleSandboxToolsChange(target) {
  if (!isSandboxToolsEnabled() || !target.matches?.('[data-sandbox-import]')) return { handled: false };
  const file = target.files?.[0];
  if (!file) return { handled: true, ok: false, message: 'Seleccioná un archivo JSON.' };
  try {
    const text = await file.text();
    const result = await getOrderRepository().importSandboxState(text);
    feedback = result.message || '';
    target.value = '';
    return { handled: true, ok: result.ok, message: result.message };
  } catch (_) {
    target.value = '';
    return { handled: true, ok: false, message: 'No se pudo importar el estado sandbox.' };
  }
}
