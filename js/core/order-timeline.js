// Línea de estado UNIFICADA del pedido: mismo vocabulario para Cliente, Negocio
// y Rider, para que cualquiera entienda en segundos en qué paso está el mismo
// pedido. No inventa estados nuevos, sólo une los reales (on_the_way/arriving)
// bajo una sola etiqueta de etapa ("En reparto").
export const ORDER_TIMELINE_STEPS = Object.freeze([
  { key: 'received', label: 'Recibido' },
  { key: 'preparing', label: 'En preparación' },
  { key: 'ready', label: 'Listo' },
  { key: 'delivery', label: 'En reparto' },
  { key: 'delivered', label: 'Entregado' },
]);

export function orderTimelineIndex(status) {
  if (status === 'preparing') return 1;
  if (status === 'ready') return 2;
  if (status === 'on_the_way' || status === 'arriving') return 3;
  if (status === 'delivered') return 4;
  return 0; // received y cualquier estado previo a aceptar
}

export function renderOrderTimeline(status, { className = '' } = {}) {
  const isCancelled = status === 'cancelled';
  const stepIndex = orderTimelineIndex(status);
  const steps = ORDER_TIMELINE_STEPS.map((step, index) => {
    let cls = 'pending';
    if (!isCancelled && index < stepIndex) cls = 'done';
    if (!isCancelled && index === stepIndex) cls = 'current';
    return `<div class="track-step ${cls}"><span class="track-dot"></span><small>${step.label}</small></div>`;
  }).join('');
  return `<div class="track-steps ${className}">${steps}</div>`;
}
