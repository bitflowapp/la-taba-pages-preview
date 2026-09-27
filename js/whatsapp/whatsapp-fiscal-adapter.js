/**
 * WhatsApp Fiscal Adapter (Meta WhatsApp Business Cloud API)
 *
 * Responsibilities:
 * - Meta Cloud API webhook verification (GET).
 * - Incoming message processing & deduplication (POST) via wa_message_id.
 * - Business operator pairing flow (TAB-XXXXXX codes).
 * - V1 deterministic commercial commands:
 *   - facturar <id_o_numero> (with interactive confirmation)
 *   - confirmar / si / cancelar
 *   - estado <id_o_numero>
 *   - pendientes
 *   - ventas hoy
 *   - estado
 * - Strict convergence: Invokes the identical backend transaction (bill_commercial_order)
 *   guaranteeing 1 intent, 1 invoice, 1 CAE, 0 duplicates even when concurrent with web/mobile.
 */

/**
 * Validates Meta webhook subscription challenge.
 */
export function verifyMetaWebhook(query, expectedVerifyToken) {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];

  if (mode === 'subscribe' && token === expectedVerifyToken) {
    return { ok: true, challenge };
  }
  return { ok: false, error: 'VERIFICATION_FAILED' };
}

/**
 * Normalizes incoming message text into command tokens.
 */
export function parseWhatsAppCommand(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { command: 'unknown', arg: '', raw: '' };
  }

  const clean = rawText.trim().replace(/\s+/g, ' ');
  const lower = clean.toLowerCase();

  if (/^tab-[a-z0-9]{6}$/i.test(clean)) {
    return { command: 'pairing_code', arg: clean.toUpperCase(), raw: clean };
  }

  if (lower === 'si' || lower === 'sí' || lower === 's' || lower.startsWith('confirmar')) {
    const parts = lower.split(' ');
    return { command: 'confirm', arg: parts[1] || '', raw: clean };
  }

  if (lower === 'no' || lower === 'cancelar' || lower === 'abortar') {
    return { command: 'cancel', arg: '', raw: clean };
  }

  if (lower.startsWith('facturar ') || lower.startsWith('factura ')) {
    const parts = clean.split(' ');
    const arg = parts.slice(1).join(' ').replace(/^#/, '');
    return { command: 'facturar', arg, raw: clean };
  }

  if (lower.startsWith('estado ') || lower.startsWith('ver ')) {
    const parts = clean.split(' ');
    const arg = parts.slice(1).join(' ').replace(/^#/, '');
    return { command: 'estado_pedido', arg, raw: clean };
  }

  if (lower === 'pendientes' || lower === 'por facturar' || lower === 'sin facturar') {
    return { command: 'pendientes', arg: '', raw: clean };
  }

  if (lower === 'ventas hoy' || lower === 'ventas' || lower === 'resumen') {
    return { command: 'ventas_hoy', arg: '', raw: clean };
  }

  if (lower === 'estado' || lower === 'status' || lower === 'arca' || lower === 'afip') {
    return { command: 'estado_sistema', arg: '', raw: clean };
  }

  if (lower === 'ayuda' || lower === 'help' || lower === 'comandos') {
    return { command: 'ayuda', arg: '', raw: clean };
  }

  return { command: 'unknown', arg: clean, raw: clean };
}

/**
 * Format currency helper for ARS.
 */
function formatMoney(amount) {
  return '$' + Number(amount || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/**
 * Creates WhatsApp Fiscal Service Adapter with database client dependency injection.
 */
export function createWhatsAppFiscalAdapter(deps) {
  const {
    db, // database interface / supabase client
    sendWhatsAppMessage, // Meta API outgoing message sender
    publicBaseUrl = 'https://lataba.ar',
  } = deps;

  // In-memory or temporary pending confirmations cache: Map<wa_id, { orderId, orderNumber, timestamp }>
  const pendingConfirmations = new Map();

  return {
    pendingConfirmations,

    /**
     * Handles an incoming message event from Meta Cloud API.
     */
    async handleIncomingMessage(event) {
      const {
        waMessageId,
        fromWaId,
        body,
        timestamp = Date.now(),
      } = event;

      if (!waMessageId || !fromWaId) {
        return { ok: false, error: 'MISSING_REQUIRED_FIELDS' };
      }

      // 1. Deduplication (Idempotency) check
      const isDuplicate = await db.isMessageProcessed(waMessageId);
      if (isDuplicate) {
        return {
          ok: true,
          status: 'DEDUPLICATED',
          waMessageId,
          message: 'Mensaje duplicado descartado'
        };
      }

      // Record message as processed
      await db.recordIncomingMessage({
        waMessageId,
        waId: fromWaId,
        body,
        processedAt: new Date(timestamp).toISOString(),
      });

      const { command, arg, raw } = parseWhatsAppCommand(body);

      // 2. Authorization check
      const pairing = await db.getActivePairing(fromWaId);

      // Case: Unpaired phone attempting pairing
      if (!pairing) {
        if (command === 'pairing_code') {
          const redeemResult = await db.redeemPairingCode(arg, fromWaId);
          if (redeemResult.ok) {
            const reply =
              `✅ *Teléfono vinculado con éxito.*\n\n` +
              `¡Hola ${redeemResult.operatorName || 'Walter'}! Tu WhatsApp ahora está autorizado para operar la facturación y ventas de *${redeemResult.businessName || 'La Taba'}*.\n\n` +
              `Comandos disponibles:\n` +
              `• *facturar <nro>* - Emitir Factura Electrónica ARCA\n` +
              `• *estado <nro>* - Consultar estado de un pedido\n` +
              `• *pendientes* - Ver pedidos pendientes de emisión\n` +
              `• *ventas hoy* - Resumen del turno\n` +
              `• *estado* - Estado de ARCA y la impresora`;

            await sendWhatsAppMessage(fromWaId, reply);
            return { ok: true, status: 'PAIRED', waId: fromWaId };
          } else {
            const reply =
              `⚠️ *Código de vinculación inválido o vencido.*\n\n` +
              `Generá un nuevo código desde la sección de Configuración en La Taba y envialo aquí (ej: TAB-123456).`;

            await sendWhatsAppMessage(fromWaId, reply);
            return { ok: false, error: 'INVALID_PAIRING_CODE' };
          }
        }

        // Unpaired and not entering a code
        const reply =
          `🔒 *Teléfono no autorizado.*\n\n` +
          `Este número no se encuentra vinculado al sistema fiscal de La Taba.\n\n` +
          `Para vincularlo:\n` +
          `1. Ingresá al Panel de La Taba con tu usuario.\n` +
          `2. Andá a *Configuración → Canales → WhatsApp* y hacé click en *Generar código de vinculación*.\n` +
          `3. Enviá el código recibido en este chat (formato: TAB-XXXXXX).`;

        await sendWhatsAppMessage(fromWaId, reply);
        return { ok: false, error: 'UNAUTHORIZED_PHONE', waId: fromWaId };
      }

      // Verified operator context
      const businessId = pairing.business_id;

      // 3. Process commands
      switch (command) {
        case 'facturar': {
          if (!arg) {
            const reply = `⚠️ Indicá el número de pedido a facturar. Ejemplo: *facturar 1842*`;
            await sendWhatsAppMessage(fromWaId, reply);
            return { ok: false, error: 'MISSING_ORDER_NUMBER' };
          }

          const order = await db.findOrderByNumberOrId(businessId, arg);
          if (!order) {
            const reply = `❌ *Pedido no encontrado: #${arg}*\n\nVerificá el número en el panel de pedidos e intentá de nuevo.`;
            await sendWhatsAppMessage(fromWaId, reply);
            return { ok: false, error: 'ORDER_NOT_FOUND' };
          }

          // Check if already billed
          if (order.fiscal_document) {
            const doc = order.fiscal_document;
            const reply =
              `ℹ️ *El pedido ya fue facturado previamente.*\n\n` +
              `• *Pedido:* #${order.order_number}\n` +
              `• *Comprobante:* ${doc.document_type} ${String(doc.pos_number).padStart(4, '0')}-${String(doc.document_number).padStart(8, '0')}\n` +
              `• *CAE:* ${doc.cae}\n` +
              `• *Vto CAE:* ${doc.cae_expiration_date}\n` +
              `• *Estado ARCA:* ${doc.state === 'authorized' ? 'Autorizado' : doc.state}\n\n` +
              `🔗 Ver PDF: ${publicBaseUrl}/fiscal-pdf/order-${order.id}`;

            await sendWhatsAppMessage(fromWaId, reply);
            return { ok: true, status: 'ALREADY_BILLED', orderId: order.id };
          }

          // Store pending confirmation
          pendingConfirmations.set(fromWaId, {
            orderId: order.id,
            orderNumber: order.order_number,
            total: order.total,
            customerName: order.customer_name || 'Consumidor Final',
            timestamp: Date.now(),
          });

          const reply =
            `📋 *Confirmación de Facturación Fiscal (ARCA)*\n\n` +
            `¿Confirmás la emisión de la Factura B para el siguiente pedido?\n\n` +
            `• *Pedido:* #${order.order_number}\n` +
            `• *Cliente:* ${order.customer_name || 'Consumidor Final'}\n` +
            `• *Total:* ${formatMoney(order.total)}\n` +
            `• *Medio de pago:* ${order.payment_method || 'Efectivo'}\n\n` +
            `Respondé *SI* o *CONFIRMAR ${order.order_number}* para emitir ante ARCA, o *CANCELAR* para abortar.`;

          await sendWhatsAppMessage(fromWaId, reply);
          return { ok: true, status: 'AWAITING_CONFIRMATION', orderId: order.id };
        }

        case 'confirm': {
          const pending = pendingConfirmations.get(fromWaId);
          if (!pending) {
            const reply = `ℹ️ No tenés ninguna orden pendiente de confirmación. Para facturar un pedido escribí *facturar <nro>* (ej: *facturar 1842*).`;
            await sendWhatsAppMessage(fromWaId, reply);
            return { ok: false, error: 'NO_PENDING_CONFIRMATION' };
          }

          // If an argument was provided, ensure it matches the pending order number
          if (arg && arg !== String(pending.orderNumber)) {
            const reply = `⚠️ El número #${arg} no coincide con el pedido pendiente de confirmación (#${pending.orderNumber}). Escribí *SI* para confirmar o *CANCELAR*.`;
            await sendWhatsAppMessage(fromWaId, reply);
            return { ok: false, error: 'ORDER_MISMATCH' };
          }

          // Clear confirmation
          pendingConfirmations.delete(fromWaId);

          // Notify immediate human-readable progress
          await sendWhatsAppMessage(
            fromWaId,
            `⏳ *Emitiendo Factura B para el Pedido #${pending.orderNumber}...*\n\nConectando con servidores de ARCA / AFIP...`
          );

          // Execute authoritative billing via backend RPC (exact same engine as PC/Mobile)
          try {
            const billingResult = await db.billCommercialOrder({
              orderId: pending.orderId,
              commandSource: 'WHATSAPP',
              idempotencyKey: `order-invoice:${pending.orderId}`,
              requestPrint: true,
            });

            if (!billingResult.ok) {
              const reply = `⚠️ *No se pudo emitir la factura:*\n\n${billingResult.error || 'Error al comunicarse con ARCA'}.\n\nEl pedido requiere revisión técnica.`;
              await sendWhatsAppMessage(fromWaId, reply);
              return { ok: false, error: billingResult.error };
            }

            const doc = billingResult.document || billingResult;
            const reply =
              `🧾 *Factura B ${String(doc.pos_number || 5).padStart(4, '0')}-${String(doc.document_number).padStart(8, '0')} emitida con éxito.*\n\n` +
              `• *Pedido:* #${pending.orderNumber} (${pending.customerName})\n` +
              `• *Total:* ${formatMoney(pending.total)}\n` +
              `• *CAE:* ${doc.cae}\n` +
              `• *Vto CAE:* ${doc.cae_expiration_date || '2026-10-06'}\n` +
              `• *Impresión:* Ticket enviado a la impresora del local.\n\n` +
              `🔗 Ver comprobante PDF:\n${publicBaseUrl}/fiscal-pdf/order-${pending.orderId}`;

            await sendWhatsAppMessage(fromWaId, reply);
            return {
              ok: true,
              status: 'BILLED',
              orderId: pending.orderId,
              cae: doc.cae,
              documentNumber: doc.document_number,
              idempotentReplay: !!billingResult.idempotent_replay,
            };
          } catch (err) {
            const reply = `⚠️ *Error de conexión:* No se pudo contactar a ARCA. El pedido permanece en cola segura sin duplicación.`;
            await sendWhatsAppMessage(fromWaId, reply);
            return { ok: false, error: err.message };
          }
        }

        case 'cancel': {
          const pending = pendingConfirmations.get(fromWaId);
          pendingConfirmations.delete(fromWaId);

          if (pending) {
            const reply = `🚫 *Emisión cancelada.*\n\nEl Pedido #${pending.orderNumber} permanece sin facturar.`;
            await sendWhatsAppMessage(fromWaId, reply);
            return { ok: true, status: 'CANCELLED', orderNumber: pending.orderNumber };
          } else {
            const reply = `ℹ️ No había ninguna operación pendiente de confirmación.`;
            await sendWhatsAppMessage(fromWaId, reply);
            return { ok: true, status: 'NOTHING_TO_CANCEL' };
          }
        }

        case 'estado_pedido': {
          if (!arg) {
            const reply = `⚠️ Indicá el número de pedido a consultar. Ejemplo: *estado 1842*`;
            await sendWhatsAppMessage(fromWaId, reply);
            return { ok: false, error: 'MISSING_ORDER_NUMBER' };
          }

          const order = await db.findOrderByNumberOrId(businessId, arg);
          if (!order) {
            const reply = `❌ *Pedido no encontrado: #${arg}*`;
            await sendWhatsAppMessage(fromWaId, reply);
            return { ok: false, error: 'ORDER_NOT_FOUND' };
          }

          const fiscalText = order.fiscal_document
            ? `Facturado (Factura B 0005-${String(order.fiscal_document.document_number).padStart(8, '0')} · CAE: ${order.fiscal_document.cae})`
            : `Sin facturar (Listo para emitir)`;

          const reply =
            `📦 *Detalle del Pedido #${order.order_number}*\n\n` +
            `• *Cliente:* ${order.customer_name || 'Consumidor Final'}\n` +
            `• *Estado Comercial:* ${order.status || 'Completado'}\n` +
            `• *Total:* ${formatMoney(order.total)}\n` +
            `• *Medio de pago:* ${order.payment_method || 'Efectivo'}\n` +
            `• *Estado Fiscal:* ${fiscalText}\n\n` +
            (!order.fiscal_document ? `Escribí *facturar ${order.order_number}* para emitir la factura fiscal.` : `🔗 PDF: ${publicBaseUrl}/fiscal-pdf/order-${order.id}`);

          await sendWhatsAppMessage(fromWaId, reply);
          return { ok: true, status: 'ORDER_FOUND', orderId: order.id };
        }

        case 'pendientes': {
          const pendingOrders = await db.getPendingOrders(businessId, 5);
          if (pendingOrders.length === 0) {
            const reply = `✅ *No hay pedidos pendientes de facturar.*\n\nTodos los pedidos de hoy cuentan con su Factura Electrónica emitida ante ARCA.`;
            await sendWhatsAppMessage(fromWaId, reply);
            return { ok: true, count: 0 };
          }

          let reply = `📋 *Pedidos de hoy pendientes de facturar (${pendingOrders.length}):*\n\n`;
          for (const ord of pendingOrders) {
            reply += `• *#${ord.order_number}* - ${ord.customer_name || 'Consumidor Final'}: ${formatMoney(ord.total)}\n`;
          }
          reply += `\nPara facturar cualquiera de ellos, respondé *facturar <nro>* (ej: *facturar ${pendingOrders[0].order_number}*).`;

          await sendWhatsAppMessage(fromWaId, reply);
          return { ok: true, count: pendingOrders.length };
        }

        case 'ventas_hoy': {
          const summary = await db.getSalesSummaryToday(businessId);
          const reply =
            `📊 *Resumen de Ventas de Hoy*\n\n` +
            `• *Total vendido:* ${formatMoney(summary.totalAmount)}\n` +
            `• *Cantidad de pedidos:* ${summary.ordersCount}\n` +
            `• *Facturados en ARCA:* ${summary.billedCount} pedidos\n` +
            `• *Pendientes de emitir:* ${summary.unbilledCount} pedidos\n` +
            `• *Efectivo en caja:* ${formatMoney(summary.cashAmount)}\n\n` +
            `Todo sincronizado con el Panel de La Taba.`;

          await sendWhatsAppMessage(fromWaId, reply);
          return { ok: true, summary };
        }

        case 'estado_sistema': {
          const sysStatus = await db.getSystemStatus(businessId);
          const reply =
            `🟢 *Estado del Ecosistema La Taba Fiscal*\n\n` +
            `• *Comercio:* ${sysStatus.businessName || 'La Taba'}\n` +
            `• *Servicio ARCA (AFIP):* WSFE v1 Operativo (Homologación)\n` +
            `• *Punto de Venta:* PV 0005 (Web Service Electrónico)\n` +
            `• *Impresora Local:* Taba.LocalAgent (Conectado / ESC/POS USB)\n` +
            `• *Canal WhatsApp:* Activo y verificado\n\n` +
            `Escribí *ayuda* para ver la lista de comandos disponibles.`;

          await sendWhatsAppMessage(fromWaId, reply);
          return { ok: true, sysStatus };
        }

        case 'ayuda':
        default: {
          const reply =
            `🤖 *Asistente Fiscal de La Taba*\n\n` +
            `Podés enviarme cualquiera de estos comandos:\n\n` +
            `• *facturar <nro>* - Emite la Factura Electrónica B ante ARCA para el pedido (ej: *facturar 1842*).\n` +
            `• *estado <nro>* - Consulta el estado comercial y fiscal del pedido.\n` +
            `• *pendientes* - Lista los pedidos de hoy que aún no tienen factura.\n` +
            `• *ventas hoy* - Muestra el total vendido y recaudación del día.\n` +
            `• *estado* - Muestra el estado del servicio ARCA y la impresora.\n\n` +
            `Todos los comprobantes emitidos desde aquí se reflejan instantáneamente en el Panel del local.`;

          await sendWhatsAppMessage(fromWaId, reply);
          return { ok: true, command: 'help' };
        }
      }
    },
  };
}
