// LA BANDEJA DEL PANEL, EN UN TELÉFONO Y CON EL SERVIDOR MOVIÉNDOSE.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// ---------------------------
// `panel-responsive.spec.mjs` ya fija la forma: que no desborde, que la
// navegación esté abajo, que nada se toque con menos de 44px. Lo que no fijaba
// es el COMPORTAMIENTO con pedidos entrando: un tablero puede estar impecable a
// 390px y aun así perder un pedido, duplicar una transición con un doble toque
// o mostrar «listo» sobre un error del servidor.
//
// Acá el servidor es un modelo con estado —una lista de pedidos que cambia y un
// `transition_order` que cuenta cuántas veces lo llamaron—, así que se puede
// probar lo que de verdad rompe un turno:
//
//   · el pedido nuevo aparece SOLO, sin que nadie recargue
//   · el detalle se abre sin salir de la bandeja y sobrevive a ese repintado
//   · el teléfono se marca y WhatsApp abre el número internacional correcto
//   · un doble toque manda UNA transición, no dos
//   · recargar no inventa un estado: se vuelve a leer del servidor
//   · volver de sin-conexión recupera lo que cambió mientras tanto
//   · dos pestañas terminan mostrando lo mismo
//   · un error del servidor NO se muestra como éxito
//   · el aviso de un pedido no se repite después de recargar
import { expect, test } from '@playwright/test';

import {
  BUSINESS_ID,
  SUPABASE_URL,
  instalarDatosDePrueba,
  pedidos,
} from '../../scripts/lib/business-panel-fixtures.mjs';

const TELEFONO = { width: 390, height: 844 };
const ANCHOS = [320, 390, 430];

/**
 * Un servidor de pedidos con estado, encima del interceptor de la biblioteca.
 *
 * Playwright resuelve la ruta registrada MÁS TARDE primero, así que esto tiene
 * prioridad sobre `instalarDatosDePrueba` y delega el resto con `fallback()`.
 */
async function servidorDePedidos(page, { pollMs = 1500 } = {}) {
  const estado = {
    ordenes: pedidos(),
    transiciones: [],
    /** Las que de verdad cambiaron la fila. Una acción repetida no suma acá. */
    aplicadas: [],
    /** Los recibos guardados por clave de idempotencia. */
    recibos: new Map(),
    /** Las veces que el servidor contestó con un recibo en vez de aplicar. */
    replays: [],
    /** Cuando está puesto, `transition_order` contesta con ese error. */
    fallaTransicion: null,
  };

  // El sondeo de seguridad del coordinador. La configuración de la biblioteca
  // lo pone en 60s para no golpear en las capturas; acá se necesita corto
  // porque es EL camino que se está probando: sin realtime contra un servidor
  // simulado, la recuperación por sondeo es la que tiene que traer el pedido.
  //
  // Y se saca el escritorio de la ecuación. `instalarDatosDePrueba` deja un
  // `__TAURI__` de mentira para que las capturas del panel de Windows tengan
  // impresoras; con él puesto, `createBusinessPlatform()` elige la plataforma
  // nativa y la cola de comandos escribe en un `outbox_put` que devuelve `true`
  // y en un `outbox_list` que devuelve siempre `[]`. O sea: ninguna transición
  // sale nunca. Un teléfono NO tiene Tauri, así que esta suite corre sobre la
  // plataforma de navegador —IndexedDB, la cola de verdad—, que es la que usa
  // el comercio desde el mostrador.
  await page.addInitScript((ms) => {
    const config = globalThis.__LA_TABA_RUNTIME_CONFIG__;
    if (config?.repository) config.repository.pollMs = ms;
    try {
      delete globalThis.__TAURI__;
    } catch (_) {
      globalThis.__TAURI__ = undefined;
    }
  }, pollMs);

  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });

    if (path.includes('/rest/v1/orders')) {
      const query = url.searchParams;
      const porCodigo = String(query.get('public_code') || '').replace(/^eq\./, '');
      const porId = String(query.get('id') || '').replace(/^eq\./, '');
      if (porCodigo || porId) {
        const fila = estado.ordenes.find((o) => o.public_code === porCodigo || o.id === porId) || null;
        // `maybeSingle()` pide un objeto, no una lista.
        return json(fila);
      }
      return json(estado.ordenes);
    }

    if (path.includes('/rpc/transition_order')) {
      const cuerpo = JSON.parse(route.request().postData() || '{}');
      estado.transiciones.push(cuerpo);
      /*
       * EL RECIBO IDEMPOTENTE, QUE ES LO QUE HACE DURABLE A UNA SOLA OPERACIÓN.
       *
       * El servidor real guarda la clave y, si vuelve la misma, devuelve la
       * fila TAL COMO QUEDÓ la primera vez en lugar de volver a aplicar el
       * cambio. Sin modelarlo acá, dos envíos de la misma acción subirían la
       * revisión dos veces y la prueba de la carrera entre pestañas estaría
       * midiendo un servidor que no existe.
       */
      const clave = String(cuerpo.p_idempotency_key || '');
      if (clave && estado.recibos.has(clave)) {
        estado.replays.push(clave);
        return json(estado.recibos.get(clave));
      }
      if (estado.fallaTransicion) {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'P0001',
            message: estado.fallaTransicion,
            details: null,
            hint: null,
          }),
        });
      }
      const fila = estado.ordenes.find((o) => o.id === cuerpo.p_order_id);
      if (!fila) return json(null);
      fila.status = cuerpo.p_new_status;
      fila.revision += 1;
      fila.updated_at = new Date().toISOString();
      if (cuerpo.p_new_status === 'accepted') fila.acknowledged_at = new Date().toISOString();
      estado.aplicadas.push({ clave, orden: fila.id, estado: fila.status, revision: fila.revision });
      if (clave) estado.recibos.set(clave, { ...fila });
      return json(fila);
    }

    return route.fallback();
  });

  return estado;
}

async function abrirBandeja(browser, viewport = TELEFONO, { pollMs } = {}) {
  const context = await browser.newContext({
    viewport,
    hasTouch: viewport.width <= 500,
    isMobile: viewport.width <= 500,
  });
  const page = await context.newPage();
  await instalarDatosDePrueba(page, { conSesion: true });
  const estado = await servidorDePedidos(page, { pollMs });
  await page.goto('/#business');
  await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 30_000 });
  await irAPedidos(page);
  return { context, page, estado };
}

async function irAPedidos(page) {
  const destino = page.locator('[data-production-orders-view]:visible').first();
  await destino.click();
  await page.locator('[data-order-tray]').waitFor({ state: 'visible', timeout: 15_000 });
}

/** Un pedido nuevo, del lado del servidor. */
function pedidoNuevo(codigo, extra = {}) {
  return {
    id: `00000000-0000-4000-8000-0000000000${codigo.slice(-2)}`,
    public_code: codigo,
    business_id: BUSINESS_ID,
    status: 'submitted',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    revision: 1,
    currency_code: 'ARS',
    payment_method: 'cash',
    delivery_mode: 'delivery',
    customer_name: 'Rocío Millalén',
    customer_phone: '2995559999',
    address_label: 'Roca 120, Centro, Neuquén',
    delivery_street: 'Roca',
    delivery_street_number: '120',
    delivery_city: 'Neuquén',
    delivery_province: 'Neuquén',
    customer_notes: null,
    subtotal: 5000,
    delivery_fee: 1990,
    discount_total: 0,
    total: 6990,
    assigned_rider_user_id: null,
    order_items: [{
      id: 'nuevo-1',
      product_uuid: '99999999-9999-4999-8999-999999999950',
      name: 'Agua mineral 1,5 L',
      product_name: 'Agua mineral 1,5 L',
      quantity: 2,
      unit_price: 2500,
      unit: 'botella',
    }],
    order_events: [],
    order_combos: [],
    ...extra,
  };
}

/** ¿La página desborda a lo ancho por culpa de alguien que no es un carril? */
async function desbordaHorizontal(page) {
  return page.evaluate(() => {
    const ancho = window.innerWidth;
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    return scrollWidth > ancho + 1;
  });
}

// ---------------------------------------------------------------------------

test('un pedido nuevo entra a la bandeja SOLO, y el recuento de la sección lo dice', async ({ browser }) => {
  const { context, page, estado } = await abrirBandeja(browser);
  try {
    const nuevos = page.locator('[data-tray-section="nuevos"]');
    await expect(nuevos.locator('.order-tray-count')).toHaveText('2');

    // El servidor recibe un pedido. Nadie toca el teléfono.
    estado.ordenes.push(pedidoNuevo('LT-2099'));

    await expect(page.locator('[data-order-card="LT-2099"]')).toBeVisible({ timeout: 20_000 });
    await expect(nuevos.locator('.order-tray-count')).toHaveText('3');
    // Y el resumen del turno —lo que se le anuncia a un lector de pantalla—
    // cuenta lo mismo que la sección.
    await expect(page.locator('[data-order-tray-headline]')).toContainText('3 nuevos');
  } finally {
    await context.close();
  }
});

test('el detalle se abre sin salir de la bandeja y sigue abierto cuando entra un pedido', async ({ browser }) => {
  // Es el defecto B19 aplicado a la tarjeta: el workspace se repinta entero
  // cada vez que llega trabajo, así que un `<details open>` guardado sólo en el
  // marcado se cerraría solo en la mano de quien lo acababa de abrir.
  const { context, page, estado } = await abrirBandeja(browser);
  try {
    const tarjeta = page.locator('[data-order-card="LT-2042"]');
    const detalle = tarjeta.locator('[data-order-detail="LT-2042"]');
    await expect(detalle).not.toHaveAttribute('open', /.*/);

    const antesDeAbrir = page.url();
    await tarjeta.locator('[data-order-detail-toggle]').click();
    await expect(detalle).toHaveAttribute('open', '');
    // Abrir el detalle no navega: la bandeja sigue siendo la misma pantalla.
    expect(page.url()).toBe(antesDeAbrir);
    await expect(page.locator('[data-order-tray]')).toBeVisible();
    await expect(detalle.locator('.production-order-items li').first()).toBeVisible();

    // Entra un pedido y repinta el tablero.
    estado.ordenes.push(pedidoNuevo('LT-2098'));
    await expect(page.locator('[data-order-card="LT-2098"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-order-detail="LT-2042"]')).toHaveAttribute('open', '');
  } finally {
    await context.close();
  }
});

test('el teléfono se marca y WhatsApp abre el número internacional correcto', async ({ browser }) => {
  const { context, page } = await abrirBandeja(browser);
  try {
    const contacto = page.locator('[data-order-contact="LT-2041"]');
    await expect(contacto.locator('.order-contact-call')).toHaveAttribute('href', 'tel:2995550101');
    // 54 (país) + 9 (celular) + el número local. Sin el 9, WhatsApp no abre el
    // chat de un celular argentino.
    await expect(contacto.locator('.order-contact-wa')).toHaveAttribute(
      'href',
      'https://wa.me/5492995550101',
    );
    await expect(contacto.locator('.order-contact-wa')).toHaveAttribute('rel', /noopener/);

    // Los dos son áreas táctiles cómodas: se tocan con el pulgar y con el local
    // lleno.
    for (const enlace of ['.order-contact-call', '.order-contact-wa']) {
      const caja = await contacto.locator(enlace).boundingBox();
      expect(caja.height, `${enlace} mide ${caja.height}px de alto`).toBeGreaterThanOrEqual(44);
    }
  } finally {
    await context.close();
  }
});

test('la dirección se ve sin abrir nada, y un retiro dice que es un retiro', async ({ browser }) => {
  const { context, page } = await abrirBandeja(browser);
  try {
    await expect(page.locator('[data-order-card="LT-2041"] .production-order-address'))
      .toHaveText('Mendoza 851, Neuquén');
    // LT-2042 es `pickup`: nadie va a llevar nada, así que preguntar por la
    // dirección no tiene respuesta útil.
    await expect(page.locator('[data-order-card="LT-2042"] .production-order-address'))
      .toHaveText('Retira en el local');
  } finally {
    await context.close();
  }
});

test('la transición normal de estado la confirma el servidor y mueve el pedido de sección', async ({ browser }) => {
  const { context, page, estado } = await abrirBandeja(browser);
  try {
    const tarjeta = page.locator('[data-order-card="LT-2042"]');
    await expect(page.locator('[data-tray-section="nuevos"] [data-order-card="LT-2042"]')).toBeVisible();

    await tarjeta.locator('[data-production-business-next]').click();

    await expect(page.locator('[data-tray-section="preparando"] [data-order-card="LT-2042"]'))
      .toBeVisible({ timeout: 20_000 });
    expect(estado.transiciones.map((t) => t.p_new_status)).toEqual(['accepted']);
  } finally {
    await context.close();
  }
});

test('un doble toque manda UNA sola transición', async ({ browser }) => {
  const { context, page, estado } = await abrirBandeja(browser);
  try {
    const boton = page.locator('[data-order-card="LT-2042"] [data-production-business-next]');
    // Dos toques seguidos, como los da un dedo impaciente sobre una respuesta
    // que tarda.
    await boton.dispatchEvent('click');
    await boton.dispatchEvent('click');

    await expect(page.locator('[data-tray-section="preparando"] [data-order-card="LT-2042"]'))
      .toBeVisible({ timeout: 20_000 });
    expect(estado.transiciones.length, `se enviaron ${estado.transiciones.length} transiciones`).toBe(1);
  } finally {
    await context.close();
  }
});

test('un error del servidor NO se muestra como éxito', async ({ browser }) => {
  const { context, page, estado } = await abrirBandeja(browser);
  try {
    estado.fallaTransicion = 'El pedido cambió en otro dispositivo.';
    await page.locator('[data-order-card="LT-2042"] [data-production-business-next]').click();

    // El pedido NO se movió de sección y el botón sigue ofreciendo la acción.
    await expect(page.locator('[data-tray-section="nuevos"] [data-order-card="LT-2042"]')).toBeVisible();
    await expect(page.locator('[data-tray-section="preparando"] [data-order-card="LT-2042"]')).toHaveCount(0);
    await expect(page.locator('[data-order-card="LT-2042"] [data-production-business-next]'))
      .not.toHaveText(/Confirmando/);
  } finally {
    await context.close();
  }
});

test('recargar no inventa un estado: se vuelve a leer del servidor', async ({ browser }) => {
  const { context, page, estado } = await abrirBandeja(browser);
  try {
    await page.locator('[data-order-card="LT-2042"] [data-production-business-next]').click();
    await expect(page.locator('[data-tray-section="preparando"] [data-order-card="LT-2042"]'))
      .toBeVisible({ timeout: 20_000 });

    await page.reload();
    await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 30_000 });
    await irAPedidos(page);

    await expect(page.locator('[data-tray-section="preparando"] [data-order-card="LT-2042"]')).toBeVisible();
    // Y sigue habiendo UNA sola transición: la recarga no reenvía nada.
    expect(estado.transiciones.length).toBe(1);
  } finally {
    await context.close();
  }
});

test('volver de sin-conexión recupera lo que cambió mientras tanto', async ({ browser }) => {
  const { context, page, estado } = await abrirBandeja(browser);
  try {
    await context.setOffline(true);
    await page.evaluate(() => globalThis.dispatchEvent(new Event('offline')));
    await expect(page.locator('[data-business-intake-status]')).toHaveClass(/is-offline/);

    // Mientras el teléfono no ve nada, el mostrador de al lado acepta un pedido
    // y entra otro.
    const enCurso = estado.ordenes.find((o) => o.public_code === 'LT-2042');
    enCurso.status = 'preparing';
    enCurso.revision += 1;
    estado.ordenes.push(pedidoNuevo('LT-2097'));

    await context.setOffline(false);
    await page.evaluate(() => globalThis.dispatchEvent(new Event('online')));

    await expect(page.locator('[data-tray-section="preparando"] [data-order-card="LT-2042"]'))
      .toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-order-card="LT-2097"]')).toBeVisible({ timeout: 20_000 });
  } finally {
    await context.close();
  }
});

test('dos pestañas del mismo comercio terminan mostrando lo mismo', async ({ browser }) => {
  // El servidor es la autoridad: lo que se hace desde una pantalla tiene que
  // aparecer en la otra sin que nadie recargue.
  const context = await browser.newContext({ viewport: TELEFONO, hasTouch: true, isMobile: true });
  try {
    const mostrador = await context.newPage();
    await instalarDatosDePrueba(mostrador, { conSesion: true });
    const estado = await servidorDePedidos(mostrador);
    await mostrador.goto('/#business');
    await mostrador.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 30_000 });
    await irAPedidos(mostrador);

    // La segunda pantalla comparte el modelo de servidor de la primera: es el
    // mismo comercio visto desde otro aparato.
    const cocina = await context.newPage();
    await instalarDatosDePrueba(cocina, { conSesion: true });
    await cocina.route(`${SUPABASE_URL}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.includes('/rest/v1/orders')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(estado.ordenes),
        });
      }
      return route.fallback();
    });
    await cocina.addInitScript(() => {
      const config = globalThis.__LA_TABA_RUNTIME_CONFIG__;
      if (config?.repository) config.repository.pollMs = 1500;
    });
    await cocina.goto('/#business');
    await cocina.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 30_000 });
    await irAPedidos(cocina);

    await mostrador.locator('[data-order-card="LT-2042"] [data-production-business-next]').click();
    await expect(mostrador.locator('[data-tray-section="preparando"] [data-order-card="LT-2042"]'))
      .toBeVisible({ timeout: 20_000 });

    await expect(cocina.locator('[data-tray-section="preparando"] [data-order-card="LT-2042"]'))
      .toBeVisible({ timeout: 25_000 });
  } finally {
    await context.close();
  }
});

/*
 * LA CARRERA DE VERDAD: LAS DOS PESTAÑAS TOCAN EL MISMO BOTÓN A LA VEZ.
 * ===========================================================================
 * «Dos pestañas terminan mostrando lo mismo» prueba la PROPAGACIÓN: una hace,
 * la otra se entera. No prueba la carrera, que es otra cosa y es la que pasa en
 * un mostrador con dos aparatos: el de adelante y el de la cocina aceptan el
 * mismo pedido con un segundo de diferencia, o menos.
 *
 * Las dos pestañas comparten origen, así que comparten IndexedDB y comparten la
 * cola de comandos. Cada una tiene su propia cadena de encolado, así que las dos
 * pueden pasar el `findByIdempotencyKey` antes de que cualquiera escriba, y la
 * segunda choca contra el índice único.
 *
 * Antes ese choque viajaba como excepción hasta la acción del operador: la
 * pantalla decía que falló algo que YA estaba encolado y en camino. Un error
 * falso sobre una operación que salió bien es peor que no decir nada, porque la
 * respuesta natural es volver a tocar.
 *
 * Lo que se exige acá son las cuatro cosas, y ninguna se puede sacar de las
 * otras tres:
 *
 *   1. UNA sola operación durable: la fila cambia una vez.
 *   2. Ninguna duplicación: la revisión sube UNA vez, no dos.
 *   3. El perdedor reconoce la operación ganadora: las dos pestañas terminan
 *      mostrando el pedido en su sección nueva.
 *   4. Ningún error falso: ninguna de las dos pantallas pide intervención.
 */
test('dos pestañas aceptan el MISMO pedido a la vez: una sola operación, sin error falso', async ({ browser }) => {
  const context = await browser.newContext({ viewport: TELEFONO, hasTouch: true, isMobile: true });
  try {
    const mostrador = await context.newPage();
    await instalarDatosDePrueba(mostrador, { conSesion: true });
    const estado = await servidorDePedidos(mostrador, { pollMs: 1500 });

    // La cocina comparte el MISMO modelo de servidor y el mismo origen: es el
    // mismo comercio, y por lo tanto la misma cola de comandos en IndexedDB.
    const cocina = await context.newPage();
    await instalarDatosDePrueba(cocina, { conSesion: true });
    await cocina.route(`${SUPABASE_URL}/**`, async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (path.includes('/rest/v1/orders')) {
        const query = url.searchParams;
        const porCodigo = String(query.get('public_code') || '').replace(/^eq\./, '');
        const porId = String(query.get('id') || '').replace(/^eq\./, '');
        if (porCodigo || porId) {
          return json(estado.ordenes.find((o) => o.public_code === porCodigo || o.id === porId) || null);
        }
        return json(estado.ordenes);
      }
      if (path.includes('/rpc/transition_order')) {
        const cuerpo = JSON.parse(route.request().postData() || '{}');
        estado.transiciones.push(cuerpo);
        const clave = String(cuerpo.p_idempotency_key || '');
        if (clave && estado.recibos.has(clave)) {
          estado.replays.push(clave);
          return json(estado.recibos.get(clave));
        }
        const fila = estado.ordenes.find((o) => o.id === cuerpo.p_order_id);
        if (!fila) return json(null);
        fila.status = cuerpo.p_new_status;
        fila.revision += 1;
        fila.updated_at = new Date().toISOString();
        if (cuerpo.p_new_status === 'accepted') fila.acknowledged_at = new Date().toISOString();
        estado.aplicadas.push({ clave, orden: fila.id, estado: fila.status, revision: fila.revision });
        if (clave) estado.recibos.set(clave, { ...fila });
        return json(fila);
      }
      return route.fallback();
    });
    await cocina.addInitScript(() => {
      const config = globalThis.__LA_TABA_RUNTIME_CONFIG__;
      if (config?.repository) config.repository.pollMs = 1500;
      try { delete globalThis.__TAURI__; } catch (_) { globalThis.__TAURI__ = undefined; }

      /*
       * LA VENTANA DE LA CARRERA, ABIERTA A PROPÓSITO.
       * ---------------------------------------------------------------------
       * Sin esto la carrera no ocurre, y hay que decirlo con todas las letras
       * porque es la diferencia entre una prueba y un adorno.
       *
       * Medido: dos clics disparados desde un instante acordado caen a 14 ms
       * uno del otro, y en 14 ms la primera pestaña ya escribió en IndexedDB.
       * La segunda entonces ENCUENTRA el comando en su búsqueda por clave y se
       * va por el camino de siempre —«ya estaba encolado, devolvelo»—, que está
       * bien y es el que más se da, pero NO es el caso que rompía.
       *
       * El que rompía es el otro: que las dos búsquedas fallen antes de que
       * cualquiera escriba. Ahí la segunda choca contra el índice único de
       * `idempotencyKey`, y ese choque viajaba como excepción hasta la pantalla
       * del operador. La ventana natural para eso es de milisegundos, así que
       * esperar a que salga sola es esperar a que falle en producción.
       *
       * Acá se abre a mano: la PRIMERA búsqueda por clave de esta pestaña
       * resuelve 600 ms tarde. Lee lo que había —nada— y actúa sobre eso
       * cuando la otra pestaña ya escribió. Es exactamente el entrelazado real,
       * en un instante elegido. No se toca nada más: el `put` sale sin demora y
       * choca de verdad contra el índice.
       */
      const getOriginal = IDBIndex.prototype.get;
      // La ventana se ARMA desde la prueba, justo antes de la carrera, y no se
      // queda esperando a la primera búsqueda que pase: el Panel busca por clave
      // en otros momentos, y demorar una de ésas abre la ventana donde no hay
      // nadie compitiendo. La prueba se mira a sí misma y falla si no compitió.
      globalThis.__armarVentana = false;
      globalThis.__carreraForzada = false;
      globalThis.__choqueDeIndice = false;
      IDBIndex.prototype.get = function (clave, ...resto) {
        const peticion = getOriginal.call(this, clave, ...resto);
        if (this.name !== 'idempotencyKey' || !globalThis.__armarVentana) return peticion;
        globalThis.__armarVentana = false;
        globalThis.__carreraForzada = true;
        let manejador = null;
        Object.defineProperty(peticion, 'onsuccess', {
          configurable: true,
          get: () => manejador,
          set: (fn) => {
            manejador = fn;
            peticion.addEventListener('success', (evento) => {
              globalThis.setTimeout(() => fn.call(peticion, evento), 600);
            });
          },
        });
        return peticion;
      };

      // Y que el choque contra el índice único haya ocurrido de verdad.
      const putOriginal = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (valor, ...resto) {
        const peticion = putOriginal.call(this, valor, ...resto);
        if (valor && typeof valor === 'object' && valor.idempotencyKey) {
          peticion.addEventListener?.('error', () => { globalThis.__choqueDeIndice = true; });
        }
        return peticion;
      };
    });

    for (const pagina of [mostrador, cocina]) {
      await pagina.goto('/#business');
      await pagina.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 30_000 });
      await irAPedidos(pagina);
    }
    // Las dos tienen que estar viendo la MISMA revisión: la clave de
    // idempotencia se arma con ella, y con revisiones distintas no habría
    // carrera, habría dos acciones diferentes.
    const revisionInicial = estado.ordenes.find((o) => o.public_code === 'LT-2042').revision;
    await expect(mostrador.locator('[data-tray-section="nuevos"] [data-order-card="LT-2042"]')).toBeVisible();
    await expect(cocina.locator('[data-tray-section="nuevos"] [data-order-card="LT-2042"]')).toBeVisible();

    /*
     * A LA VEZ DE VERDAD, Y ESTO NO ES PEDantería.
     *
     * La primera versión usaba `Promise.all` sobre dos `locator.click()`.
     * Parece simultáneo y no lo es: cada `click()` de Playwright hace su ida y
     * vuelta al navegador —comprobar visibilidad, estabilidad, posición— y esas
     * idas y vueltas se serializan lo suficiente como para que la primera
     * pestaña termine de escribir en IndexedDB antes de que la segunda lea. Sin
     * carrera, la prueba pasaba IGUAL con el arreglo puesto y sin él, que es la
     * definición de una prueba que no prueba nada. (Se comprobó: pasa con el
     * `try/catch` del outbox quitado.)
     *
     * Acá se acuerda un instante y las dos pestañas disparan solas cuando
     * llega. El click sale del temporizador de cada página, sin protocolo de
     * por medio, y los dos caen dentro del mismo milisegundo.
     */
    // Recién ahora se arma la ventana: la próxima búsqueda por clave de la
    // cocina es la del clic, y es la que se demora.
    await cocina.evaluate(() => { globalThis.__armarVentana = true; });

    const cuando = Date.now() + 900;
    await Promise.all([mostrador, cocina].map((pagina) => pagina.evaluate((instante) => {
      const boton = document.querySelector('[data-order-card="LT-2042"] [data-production-business-next]');
      if (!boton) throw new Error('no está el botón de avanzar el pedido');
      return new Promise((resolver) => {
        const disparar = () => { boton.click(); resolver(globalThis.performance.now()); };
        const falta = instante - Date.now();
        if (falta <= 0) disparar();
        else globalThis.setTimeout(disparar, falta);
      });
    }, cuando)));

    // 3 · las dos pantallas terminan mostrando el pedido donde corresponde.
    await expect(mostrador.locator('[data-tray-section="preparando"] [data-order-card="LT-2042"]'))
      .toBeVisible({ timeout: 25_000 });
    await expect(cocina.locator('[data-tray-section="preparando"] [data-order-card="LT-2042"]'))
      .toBeVisible({ timeout: 25_000 });

    /*
     * ¿HUBO CARRERA? SE PREGUNTA, NO SE SUPONE.
     *
     * Sin esto, el día que las dos pestañas dejen de solaparse —porque cambió
     * un temporizador, porque el arranque se hizo más lento— la prueba seguiría
     * en verde midiendo dos acciones consecutivas. Una prueba de concurrencia
     * que dejó de competir es peor que no tenerla: dice que sí.
     *
     * `forzada` afirma que la búsqueda por clave del clic de la cocina se
     * demoró, o sea que los dos encolados estuvieron abiertos a la vez.
     *
     * HASTA DÓNDE LLEGA ESTA PRUEBA, dicho con precisión: el entrelazado que
     * queda es el de las dos búsquedas fallando antes de que cualquiera
     * escriba, y ése NO se puede fijar desde afuera. IndexedDB serializa las
     * transacciones entre pestañas por su cuenta; demorar el `onsuccess` demora
     * el MANEJADOR, no la transacción, así que quién lee primero lo decide el
     * navegador. Forzarlo pediría parchear la aplicación desde la prueba, y
     * entonces la prueba probaría el parche.
     *
     * Ese caso —el choque contra el índice único, que es lo que el arreglo del
     * outbox atiende— está cubierto de forma determinista en
     * `tests/business-outbox-continuidad.test.mjs`, donde el almacenamiento en
     * memoria modela el índice único y el entrelazado se escribe a mano. Acá se
     * prueba el contrato de punta a punta con dos pestañas de verdad; allá, la
     * rama angosta. Ninguna de las dos sobra.
     */
    const carrera = await cocina.evaluate(() => ({
      forzada: globalThis.__carreraForzada === true,
      choque: globalThis.__choqueDeIndice === true,
    }));
    expect(
      carrera.forzada,
      'la ventana de la carrera no se abrió: las dos pestañas no se solaparon y la prueba no probó nada',
    ).toBe(true);

    const fila = estado.ordenes.find((o) => o.public_code === 'LT-2042');
    const aplicadasAlPedido = estado.aplicadas.filter((a) => a.orden === fila.id);

    // 1 y 2 · una sola operación durable, y la revisión sube UNA vez.
    expect(
      aplicadasAlPedido.length,
      `el servidor aplicó ${aplicadasAlPedido.length} transiciones al mismo pedido: ${JSON.stringify(aplicadasAlPedido)}`,
    ).toBe(1);
    expect(fila.revision, 'la revisión subió más de una vez: hubo duplicación').toBe(revisionInicial + 1);
    expect(fila.status).toBe('accepted');

    // Y todas las claves que llegaron al servidor son la MISMA: si fueran dos
    // distintas, el recibo idempotente no habría podido protegernos y lo que
    // salvó la prueba sería la suerte del temporizador.
    const claves = new Set(estado.transiciones
      .filter((t) => t.p_order_id === fila.id)
      .map((t) => String(t.p_idempotency_key || '')));
    expect([...claves], 'las dos pestañas tienen que pedir lo mismo con la misma clave').toHaveLength(1);

    /*
     * 4 · NINGUNA DE LAS DOS PANTALLAS LE MIENTE AL OPERADOR.
     *
     * Se mira el TOAST y no la franja de estado, porque es ahí donde termina el
     * error: `app.js` envuelve la acción en un `try/catch` y convierte cualquier
     * excepción en un aviso. Si el choque contra el índice único escapa de la
     * cola, el operador de la segunda pantalla lee que su acción falló —cuando
     * en realidad ya está encolada y en camino— y lo natural es que vuelva a
     * tocar. Esa es la mentira que este arreglo saca.
     *
     * Se mira la franja también, por si el error llegara por el otro camino.
     */
    for (const [nombre, pagina] of [['mostrador', mostrador], ['cocina', cocina]]) {
      const aviso = (await pagina.locator('[data-toast]').textContent())?.trim() || '';
      expect(
        aviso,
        `${nombre} avisa «${aviso}» sobre una operación que salió bien`,
      ).not.toMatch(/no se pudo|error|constraint|fall/i);
      await expect(
        pagina.locator('[data-business-command-status] .production-intake-error'),
        `${nombre} muestra un error sobre una operación que salió bien`,
      ).toHaveCount(0);
    }
  } finally {
    await context.close();
  }
});

test('el aviso de un pedido no se repite después de recargar', async ({ browser }) => {
  // La regla es «una vez por pedido, aunque haya dos pestañas y aunque se
  // recargue»: la reclama `alertOnce()` con Web Locks y `localStorage`.
  const { context, page, estado } = await abrirBandeja(browser);
  try {
    estado.ordenes.push(pedidoNuevo('LT-2096'));
    await expect(page.locator('[data-order-card="LT-2096"]')).toBeVisible({ timeout: 20_000 });

    const clave = `la-taba-business-intake:${BUSINESS_ID}:alerts`;
    const anunciados = async () => page.evaluate((k) => {
      try {
        return JSON.parse(globalThis.localStorage.getItem(k) || '[]')
          .filter((registro) => registro && registro.orderId).length;
      } catch (_) {
        return -1;
      }
    }, clave);

    const antes = await anunciados();
    expect(antes).toBeGreaterThan(0);

    await page.reload();
    await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 30_000 });
    await irAPedidos(page);
    await expect(page.locator('[data-order-card="LT-2096"]')).toBeVisible({ timeout: 20_000 });

    expect(await anunciados(), 'la recarga volvió a anunciar pedidos ya anunciados').toBe(antes);
  } finally {
    await context.close();
  }
});

for (const width of ANCHOS) {
  test(`a ${width}px la bandeja no desborda y el aviso de atención se lee`, async ({ browser }) => {
    const { context, page } = await abrirBandeja(browser, { width, height: width === 320 ? 568 : 844 });
    try {
      expect(await desbordaHorizontal(page), `la bandeja desborda a ${width}px`).toBe(false);

      // La sección de atención existe y su tarjeta dice, en castellano, qué pasa.
      const atencion = page.locator('[data-tray-section="atencion"]');
      await expect(atencion).toBeVisible();
      await expect(atencion.locator('.order-attention-chip').first())
        .toContainText('Listo sin repartidor');
      // El código técnico viaja para soporte, pero no ocupa pantalla.
      await expect(atencion.locator('.order-attention-chip').first())
        .toHaveAttribute('data-attention-code', 'ORDER_READY_WITHOUT_RIDER');
      await expect(atencion.locator('.order-attention-chip').first()).not.toContainText('ORDER_');

      // Abrir el detalle tampoco desborda: es donde entra la lista completa de
      // productos, que es el texto más largo de la tarjeta.
      await page.locator('[data-order-detail-toggle]').first().click();
      expect(await desbordaHorizontal(page), `el detalle desborda a ${width}px`).toBe(false);
    } finally {
      await context.close();
    }
  });
}

test('sin novedades del servidor, el tablero NO se reemplaza', async ({ browser }) => {
  /*
   * La propiedad que se rompe sin que nadie lo note.
   *
   * El Panel se repinta con cada latido del coordinador. Mientras la franja de
   * estado y el reloj de espera formaban parte del marcado del tablero,
   * cualquier cambio suyo —el segundero de la última sincronización, un
   * reintento de realtime— reemplazaba el DOM ENTERO. Medido con 300 pedidos:
   * 29 reemplazos en treinta segundos, de 864 KB y 15.298 nodos cada uno, sin
   * que un solo pedido hubiera cambiado.
   *
   * Acá se cuenta lo mismo en chico, y se cuenta DOS cosas, porque desde que la
   * bandeja se reconcilia por región, sección y tarjeta hacen falta las dos:
   *
   *   · `hijosNuevos` — hijos DIRECTOS que recibe el contenedor del workspace.
   *     Es la medición original. Sigue teniendo que ser cero: la franja de
   *     estado cambia en cada latido, y actualizarla no puede costar un hijo
   *     nuevo del tablero.
   *   · `tarjetasTocadas` — tarjetas que entran o salen en TODO el subárbol. Es
   *     lo que la medición original no podía ver, porque cuando el tablero se
   *     reemplazaba entero las trescientas viajaban dentro de un solo hijo
   *     nuevo. Ahora una tarjeta que cambia se reemplaza en su lugar, adentro
   *     del cuerpo de su sección, sin tocar ningún hijo directo.
   *
   * Y por eso la comprobación de «no es un tablero congelado» mira las tarjetas
   * y no los hijos directos: un pedido que avanza de sección YA NO reemplaza
   * ningún hijo directo del workspace, que es justamente la mejora. Medirlo ahí
   * daría cero y estaría midiendo lo contrario de lo que quiere decir.
   */
  const { context, page } = await abrirBandeja(browser, TELEFONO, { pollMs: 1000 });
  try {
    await page.evaluate(() => {
      const raiz = document.querySelector('[data-production-workspace="business"]');
      const contarTarjetas = (nodo) => (nodo.nodeType !== 1
        ? 0
        : (nodo.classList?.contains('production-order-card')
          ? 1
          : (nodo.querySelectorAll?.('.production-order-card').length || 0)));
      globalThis.__reiniciarConteo = () => {
        globalThis.__hijosNuevos = 0;
        globalThis.__tarjetasTocadas = 0;
      };
      globalThis.__reiniciarConteo();
      globalThis.__observador = new MutationObserver((mutaciones) => {
        for (const m of mutaciones) {
          if (m.type !== 'childList') continue;
          if (m.target === raiz && m.addedNodes.length) globalThis.__hijosNuevos += 1;
          for (const nodo of [...m.addedNodes, ...m.removedNodes]) {
            globalThis.__tarjetasTocadas += contarTarjetas(nodo);
          }
        }
      });
      globalThis.__observador.observe(raiz, { childList: true, subtree: true });
    });

    // Ocho vueltas de sondeo sin una sola novedad.
    await page.waitForTimeout(8_000);

    const quieto = await page.evaluate(() => ({
      hijosNuevos: globalThis.__hijosNuevos,
      tarjetasTocadas: globalThis.__tarjetasTocadas,
    }));
    expect(quieto.hijosNuevos, `el tablero recibió ${quieto.hijosNuevos} hijos nuevos sin novedades`).toBe(0);
    expect(
      quieto.tarjetasTocadas,
      `se tocaron ${quieto.tarjetasTocadas} tarjetas sin que el servidor cambiara nada`,
    ).toBe(0);

    // Y cuando SÍ hay novedad, la bandeja se mueve: la guarda no puede ser un
    // tablero congelado.
    await page.evaluate(() => globalThis.__reiniciarConteo());
    await page.locator('[data-order-card="LT-2042"] [data-production-business-next]').click();
    await expect(page.locator('[data-tray-section="preparando"] [data-order-card="LT-2042"]'))
      .toBeVisible({ timeout: 20_000 });
    const conNovedad = await page.evaluate(() => {
      globalThis.__observador.disconnect();
      return { hijosNuevos: globalThis.__hijosNuevos, tarjetasTocadas: globalThis.__tarjetasTocadas };
    });
    expect(conNovedad.tarjetasTocadas, 'el pedido que avanzó tiene que llegar al DOM').toBeGreaterThan(0);
    // Y llega SIN rearmar el tablero: el pedido cambia de sección tocando su
    // tarjeta y los encabezados, nunca reemplazando un hijo del workspace.
    expect(
      conNovedad.hijosNuevos,
      'un pedido que avanza no puede reemplazar un bloque entero del tablero',
    ).toBe(0);
  } finally {
    await context.close();
  }
});

test('el reloj de la bandeja dice cuánto hace que entró el pedido, no una hora que hay que restar', async ({ browser }) => {
  const { context, page } = await abrirBandeja(browser);
  try {
    const espera = page.locator('[data-order-card="LT-2041"] [data-elapsed-from]');
    await expect(espera).toHaveText(/^(recién|hace \d+ min)$/);
    // La hora exacta no se pierde: vive en el detalle, con la zona del comercio
    // declarada y reloj de 24 horas.
    await page.locator('[data-order-card="LT-2041"] [data-order-detail-toggle]').click();
    await expect(page.locator('[data-order-card="LT-2041"] .order-detail-meta'))
      .toContainText(/\d{2}\/\d{2}\/\d{4}/);
  } finally {
    await context.close();
  }
});
