export function createSupabaseBusinessRepository({ client, businessId }) {
  assertClient(client);
  if (!businessId) throw new Error('El repositorio de negocio requiere businessId.');

  async function rpc(name, args) {
    const { data, error, status } = await client.rpc(name, args);
    if (error) return classifyRpcError(error, status);
    return { ok: true, data };
  }

  return Object.freeze({
    // El RPC `business_order_snapshot` NUNCA existió en ninguna migración:
    // llamarlo devuelve PGRST202. El snapshot autoritativo de la bandeja es
    // la consulta PostgREST de supabase_order_repository.fetchBusinessOrderSnapshot;
    // este repositorio expone la misma consulta para no prometer un contrato roto.
    async snapshot() {
      const { data, error, status } = await client
        .from('orders')
        // Sin `order_events(*)`, igual que el snapshot autoritativo: la bandeja
        // no dibuja eventos y el historial se reconstruye de las columnas de
        // fecha del pedido. La bitácora exacta se pide por pedido, al abrir la
        // auditoría. Las dos consultas tienen que pedir lo mismo o divergen.
        .select('*,order_items(*),order_combos(*)')
        .eq('business_id', businessId)
        .eq('origin', 'production')
        .order('created_at', { ascending: true })
        .limit(500);
      if (error) return classifyRpcError(error, status);
      return { ok: true, data: Array.isArray(data) ? data : [] };
    },
    acknowledgeOrder: ({ orderId, expectedRevision, idempotencyKey }) => rpc('acknowledge_order', {
      p_order_id: orderId, p_expected_revision: expectedRevision, p_idempotency_key: idempotencyKey,
    }),
    transitionOrder: ({ orderId, expectedRevision, newStatus, idempotencyKey }) => rpc('transition_order', {
      p_order_id: orderId, p_expected_revision: expectedRevision, p_new_status: newStatus, p_idempotency_key: idempotencyKey,
    }),
    setPreparationEstimate: ({ orderId, expectedRevision, minutes, idempotencyKey }) => rpc('set_preparation_estimate', {
      p_order_id: orderId, p_expected_revision: expectedRevision, p_minutes: minutes, p_idempotency_key: idempotencyKey,
    }),
    cancelOrder: ({ orderId, expectedRevision, reason, idempotencyKey }) => rpc('cancel_order', {
      p_order_id: orderId, p_expected_revision: expectedRevision, p_reason: reason, p_idempotency_key: idempotencyKey,
    }),
    listActiveRiders: () => rpc('list_active_business_riders', { p_business_id: businessId }),

    // ── Solicitudes de alta ─────────────────────────────────────────────────
    // La bandeja y la decisión pasan por RPC porque la tabla no tiene un solo
    // grant para el cliente. `identity_review_access_request` crea la
    // membresía, la seguridad y el perfil en la misma transacción que el sello
    // de aprobada: el Panel hace UNA llamada, no tres escrituras que puedan
    // quedar a mitad de camino.
    listAccessRequests: (status = 'pending') => rpc('identity_list_access_requests', {
      p_business_id: businessId, p_status: status,
    }),
    reviewAccessRequest: ({ requestId, decision, role = null, reason = null }) => rpc(
      'identity_review_access_request',
      {
        p_request_id: requestId,
        p_decision: decision,
        p_role: role,
        p_reason: reason,
      },
    ),

    // ── Configuración operativa: horarios, zonas, envío y mínimo ─────────────
    // El Panel no escribe estas tablas: no tiene permiso de tabla. Cada cambio
    // pasa por una RPC que autoriza, valida y audita en la misma transacción.
    // Un staff sin delegación recibe 42501 y `classifyRpcError` lo traduce a
    // FORBIDDEN sin filtrar el mensaje crudo de PostgreSQL.
    operationsConfig: () => rpc('get_business_operations_config', { p_business_id: businessId }),
    setServiceHours: ({ channel, hours }) => rpc('set_business_service_hours', {
      p_business_id: businessId, p_channel: channel, p_hours: hours,
    }),
    setServiceException: ({ channel, onDate, isClosed, opensAt = null, closesAt = null, note = null }) => rpc('set_business_service_exception', {
      p_business_id: businessId, p_channel: channel, p_on_date: onDate,
      p_is_closed: isClosed, p_opens_at: opensAt, p_closes_at: closesAt, p_note: note,
    }),
    deleteServiceException: ({ exceptionId }) => rpc('delete_business_service_exception', {
      p_business_id: businessId, p_exception_id: exceptionId,
    }),
    upsertDeliveryZone: ({ zone }) => rpc('upsert_delivery_zone', {
      p_business_id: businessId, p_zone: zone,
    }),
    setDeliveryZoneActive: ({ zoneId, active }) => rpc('set_delivery_zone_active', {
      p_business_id: businessId, p_zone_id: zoneId, p_active: active,
    }),
    deleteDeliveryZone: ({ zoneId }) => rpc('delete_delivery_zone', {
      p_business_id: businessId, p_zone_id: zoneId,
    }),
    setDeliveryPricing: ({ deliveryFee = null, minimumSubtotal = null, maxRadiusMeters = null }) => rpc('set_delivery_pricing', {
      p_business_id: businessId, p_delivery_fee: deliveryFee,
      p_minimum_subtotal: minimumSubtotal, p_max_radius_meters: maxRadiusMeters,
    }),
    setServiceEnforcement: ({ hoursEnforced, coverageEnforced, alcoholHoursEnforced = null, timezone = null }) => rpc('set_service_enforcement', {
      p_business_id: businessId, p_hours_enforced: hoursEnforced,
      p_delivery_zone_enforced: coverageEnforced,
      p_alcohol_hours_enforced: alcoholHoursEnforced, p_timezone: timezone,
    }),
    setCommercialSettingsDelegation: ({ userId, canManage }) => rpc('set_commercial_settings_delegation', {
      p_business_id: businessId, p_user_id: userId, p_can_manage: canManage,
    }),
  });
}

export function classifyRpcError(error, status = 0) {
  const code = String(error?.code || 'RPC_ERROR');
  const message = safeMessage(error?.message || 'La operaci\u00f3n no fue confirmada por el servidor.');
  if (code === '40001') return { ok: false, conflict: true, code: 'REVISION_CONFLICT', message };
  if (code === '42501' || status === 401 || status === 403) return { ok: false, retryable: false, code: status === 401 ? 'SESSION_EXPIRED' : 'FORBIDDEN', message };
  if (code === 'P0002') return { ok: false, retryable: false, code: 'NOT_FOUND', message };
  if (code === '22023' || code === '23514' || code === '23505' || code === 'P0001') return { ok: false, retryable: false, code, message };
  if (status === 429) return { ok: false, retryable: true, code: 'RATE_LIMITED', message };
  if (status >= 500 || status === 0) return { ok: false, retryable: true, code: 'SERVER_UNAVAILABLE', message };
  return { ok: false, retryable: false, code, message };
}

function assertClient(client) { if (typeof client?.rpc !== 'function') throw new Error('Cliente Supabase inv\u00e1lido.'); }
// PostgreSQL nombra la tabla y el constraint cuando rechaza una fila. El operador no tiene que leer eso.
const RAW_DATABASE_ERROR = /violates .*constraint|new row for relation|null value in column|duplicate key value|permission denied for|\bpg_[a-z_]+\b|invalid input syntax/i;
function safeMessage(value) {
  const flat = String(value || '').replace(/[\r\n\t]+/g, ' ').slice(0, 300);
  return RAW_DATABASE_ERROR.test(flat) ? 'La operación no fue aceptada por el servidor.' : flat;
}
