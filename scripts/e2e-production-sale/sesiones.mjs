/*
 * LAS SESIONES, SIN QUE NADIE TENGA QUE INICIARLAS.
 *
 * Antes cada corrida empezaba con una persona abriendo un navegador y
 * escribiendo su contraseña. Acá no: una sesión guardada se reutiliza mientras
 * sirva, y cuando deja de servir se rehace sola.
 *
 * LOS DOS CANALES SE REHACEN DE MANERAS DISTINTAS, Y NO ES UN CAPRICHO
 * -------------------------------------------------------------------
 *   · PANEL. Hay correo y contraseña. La contraseña vive en el Credential
 *     Manager de Windows y se usa para volver a entrar POR LA PANTALLA DE
 *     INGRESO de siempre —no por la API—: así la sesión queda registrada en
 *     `identity_register_session`, que es lo que la compuerta autoritativa del
 *     servidor exige para devolver un rol. Entrar por la puerta de atrás daría
 *     un token válido y un rol nulo.
 *
 *   · CLIENTE. No hay contraseña que guardar: la tienda no tiene registro de
 *     clientes, cada visitante recibe una identidad anónima cuando guarda algo.
 *     Si esa identidad se pierde no se puede «recuperar»; se fabrica otra, con
 *     el mismo perfil y la misma dirección aprobada, por las mismas pantallas
 *     que usaría una persona. Es más lento y es la única forma honesta.
 *
 * POR QUÉ SE VUELVE A GUARDAR EL ESTADO DESPUÉS DE CADA USO
 * --------------------------------------------------------
 * Porque el proyecto tiene rotación de refresh tokens con detección de reuso
 * (`refresh_token_rotation_enabled`). Cada vez que el navegador refresca, el
 * token viejo queda quemado; si se guardara el archivo una sola vez y se
 * reusara, la segunda corrida presentaría un token ya usado y Supabase
 * revocaría la sesión entera. Guardar al salir es lo que hace que la sesión
 * sobreviva a la corrida siguiente.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PRODUCCION, RUTAS } from './contrato.mjs';
import {
  DIRECCION_DE_PRUEBA, IDENTIDAD_PANEL, RUTAS_IDENTIDAD,
  correoDelPanel, nombreDelCliente, telefonoDelCliente,
} from './identidades.mjs';
import { leerSecreto } from './secretos-windows.mjs';

const ESPERA_ARRANQUE = 90_000;
const ESPERA_CORTA = 20_000;

export class SesionImposible extends Error {
  constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; }
}

const leerJson = (ruta) => {
  try { return JSON.parse(readFileSync(ruta, 'utf8')); } catch { return null; }
};

const guardarJson = (ruta, datos) => {
  mkdirSync(path.dirname(ruta), { recursive: true });
  writeFileSync(ruta, `${JSON.stringify(datos, null, 2)}\n`);
};

/**
 * El contexto del cliente.
 *
 * Trae la ubicación ya concedida y fijada en el punto aprobado. Eso NO es
 * inventar una coordenada: es la que una persona confirmó con GPS el
 * 2026-08-18 y la única que el sistema tiene aprobada. Concederla de entrada
 * evita el diálogo de permisos, que en un navegador sin persona delante no
 * responde nadie.
 */
export async function contextoCliente(navegador, { estado = null } = {}) {
  return navegador.newContext({
    viewport: { width: 430, height: 932 },
    serviceWorkers: 'block',
    permissions: ['geolocation'],
    geolocation: {
      latitude: DIRECCION_DE_PRUEBA.latitud,
      longitude: DIRECCION_DE_PRUEBA.longitud,
      accuracy: DIRECCION_DE_PRUEBA.metrosDePrecision,
    },
    locale: 'es-AR',
    ...(estado ? { storageState: estado } : {}),
  });
}

export async function contextoPanel(navegador, { estado = null } = {}) {
  return navegador.newContext({
    viewport: { width: 1440, height: 950 },
    serviceWorkers: 'block',
    locale: 'es-AR',
    ...(estado ? { storageState: estado } : {}),
  });
}

async function abrir(contexto, hash) {
  const pagina = await contexto.newPage();
  await pagina.goto(`${PRODUCCION.host}/${hash}`, { waitUntil: 'domcontentloaded', timeout: ESPERA_ARRANQUE });
  await pagina.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached', timeout: ESPERA_ARRANQUE });
  return pagina;
}

// ── CLIENTE ──────────────────────────────────────────────────────────────────

/**
 * Qué ve el cliente de sí mismo, leído del DOM del perfil.
 *
 * Se mira el DOM y no el estado interno de la aplicación a propósito: si el
 * perfil está completo pero no se dibuja, para quien compra no está completo.
 */
async function inspeccionarCliente(pagina) {
  await pagina.waitForTimeout(2500);
  const tarjetas = pagina.locator('[data-profile-address-id]');
  const cantidad = await tarjetas.count();
  const direcciones = [];
  for (let i = 0; i < cantidad; i += 1) {
    const tarjeta = tarjetas.nth(i);
    direcciones.push({
      id: await tarjeta.getAttribute('data-profile-address-id'),
      confirmada: await tarjeta.locator('[data-address-location="confirmed"]').count() > 0,
      predeterminada: (await tarjeta.getAttribute('class') || '').includes('is-default'),
      texto: (await tarjeta.innerText().catch(() => '')).replace(/\s+/g, ' ').trim(),
    });
  }
  const nombre = await pagina.locator('[name="profileFullName"]').first().inputValue().catch(() => '');
  const textoPerfil = await pagina.locator('[data-customer-profile]').first().innerText().catch(() => '');
  return { direcciones, nombre, textoPerfil, tieneDatos: /Editar/.test(textoPerfil) || Boolean(nombre) };
}

/** ¿Sirve esta sesión de cliente para comprar? */
export function evaluarClienteAprovisionado(inspeccion, idEsperado) {
  const confirmadas = (inspeccion?.direcciones || []).filter((d) => d.confirmada);
  if (!inspeccion?.tieneDatos) {
    return { ok: false, codigo: 'CLIENTE_SIN_PERFIL', mensaje: 'el cliente de prueba no tiene nombre ni teléfono guardados' };
  }
  if (!confirmadas.length) {
    return { ok: false, codigo: 'CLIENTE_SIN_DIRECCION', mensaje: 'el cliente de prueba no tiene ninguna dirección con punto confirmado' };
  }
  if (idEsperado && !confirmadas.some((d) => d.id === idEsperado)) {
    return { ok: false, codigo: 'CLIENTE_DIRECCION_PERDIDA', mensaje: 'la dirección aprobada ya no está entre las del cliente de prueba' };
  }
  return { ok: true, codigo: null, mensaje: '', direccion: idEsperado ? confirmadas.find((d) => d.id === idEsperado) : confirmadas[0] };
}

/**
 * Fabrica el cliente de prueba desde cero, por las pantallas de siempre.
 *
 * Cada paso es el que haría una persona: completar los datos, agregar la
 * dirección, tocar «Usar mi ubicación» —que acá devuelve el punto aprobado—,
 * confirmar y guardar. Ninguna fila se escribe por afuera de la aplicación.
 */
async function fabricarCliente(pagina, { anotar }) {
  const nombre = nombreDelCliente();
  const telefono = telefonoDelCliente();

  anotar('cliente: completando nombre y teléfono');
  const abrirDatos = pagina.locator('[data-profile-action="edit-personal"]').first();
  if (await abrirDatos.count()) await abrirDatos.click();
  await pagina.locator('[name="profileFullName"]').first().waitFor({ timeout: ESPERA_CORTA });
  await pagina.locator('[name="profileFullName"]').first().fill(nombre);
  await pagina.locator('[name="profilePhone"]').first().fill(telefono);
  await pagina.locator('[data-profile-action="save-personal"]').first().click();
  await pagina.waitForTimeout(3000);

  anotar('cliente: agregando la dirección aprobada');
  const agregar = pagina.locator('[data-profile-action="add-address"]').first();
  if (await agregar.count()) await agregar.click();
  await pagina.locator('[data-profile-address-form]').first().waitFor({ timeout: ESPERA_CORTA });
  await pagina.locator('[name="profileAddressStreet"]').first().fill(DIRECCION_DE_PRUEBA.calle);
  await pagina.locator('[name="profileAddressNumber"]').first().fill(DIRECCION_DE_PRUEBA.numero);
  const etiqueta = pagina.locator('[name="profileAddressLabel"]').first();
  if (await etiqueta.count()) await etiqueta.selectOption(DIRECCION_DE_PRUEBA.etiqueta).catch(() => {});

  anotar('cliente: confirmando el punto de entrega');
  await pagina.locator('[data-profile-action="use-location"]').first().click();
  await pagina.locator('[data-profile-action="confirm-location"]').first().waitFor({ timeout: 45_000 });
  await pagina.locator('[data-profile-action="confirm-location"]').first().click();
  await pagina.locator('[data-location-confirmed]').first().waitFor({ timeout: ESPERA_CORTA });

  const predeterminada = pagina.locator('[name="profileAddressDefault"]').first();
  if (await predeterminada.count() && !(await predeterminada.isChecked())) await predeterminada.check();

  anotar('cliente: guardando la dirección');
  await pagina.locator('[data-profile-action="save-address"]').first().click();
  await pagina.waitForTimeout(4000);

  // Una dirección repetida no se duplica: si la tienda avisa que ya existe una
  // parecida, se usa la que ya está en vez de crear otra puerta.
  const duplicada = pagina.locator('[data-profile-action="duplicate-use"]').first();
  if (await duplicada.count()) {
    anotar('cliente: la tienda detectó una dirección parecida; se reutiliza la existente');
    await duplicada.click();
    await pagina.waitForTimeout(3000);
  }
}

/**
 * Deja lista la sesión del cliente y devuelve su contexto abierto.
 *
 * Reutiliza lo que haya; sólo fabrica cuando no queda otra. Y siempre vuelve a
 * escribir el estado del navegador al terminar.
 */
export async function asegurarSesionCliente({
  navegador, raiz, anotar = () => {}, permitirFabricar = true,
}) {
  const rutaEstado = path.join(raiz, RUTAS.sesionCustomer);
  const rutaFicha = path.join(raiz, RUTAS_IDENTIDAD.clienteIdentidad);
  const ficha = leerJson(rutaFicha);
  const hayEstado = existsSync(rutaEstado);

  let contexto = await contextoCliente(navegador, { estado: hayEstado ? rutaEstado : null });
  let pagina = await abrir(contexto, '#profile');
  let inspeccion = await inspeccionarCliente(pagina);
  let compuerta = evaluarClienteAprovisionado(inspeccion, ficha?.direccionId);
  let rehecha = false;

  if (!compuerta.ok) {
    /*
     * Fabricar el cliente ESCRIBE en producción: una identidad anónima, un
     * perfil y una dirección. Un ensayo no puede hacerlo sin permiso, así que
     * la decisión se pregunta ANTES de tocar nada —no después, cuando las filas
     * ya existirían—.
     */
    if (!permitirFabricar) {
      await contexto.close().catch(() => {});
      throw new SesionImposible(
        'CLIENTE_SIN_APROVISIONAR',
        `no hay cliente de prueba utilizable (${compuerta.codigo}) y este ensayo no tiene permiso para crearlo: agregá --aprovisionar`,
      );
    }
    anotar(`cliente: la sesión guardada no sirve (${compuerta.codigo}); se fabrica una nueva`);
    await contexto.close().catch(() => {});
    // Sin estado previo: identidad anónima nueva, perfil nuevo, dirección nueva.
    contexto = await contextoCliente(navegador, { estado: null });
    pagina = await abrir(contexto, '#profile');
    await fabricarCliente(pagina, { anotar });
    inspeccion = await inspeccionarCliente(pagina);
    compuerta = evaluarClienteAprovisionado(inspeccion, null);
    rehecha = true;
    if (!compuerta.ok) {
      await contexto.close().catch(() => {});
      throw new SesionImposible(compuerta.codigo, `no se pudo fabricar el cliente de prueba: ${compuerta.mensaje}`);
    }
  }

  const direccionId = compuerta.direccion?.id || '';
  guardarJson(rutaFicha, {
    direccionId,
    direccionTexto: compuerta.direccion?.texto || '',
    nombre: nombreDelCliente(),
    fabricadaUtc: rehecha ? new Date().toISOString() : ficha?.fabricadaUtc || null,
    verificadaUtc: new Date().toISOString(),
    nota: 'identidad anónima de la tienda; no tiene contraseña. El punto de entrega es el aprobado, no uno nuevo.',
  });
  await guardarEstado(contexto, rutaEstado);

  return {
    contexto, pagina, direccionId, rehecha, direccion: compuerta.direccion, rutaEstado,
  };
}

// ── PANEL ────────────────────────────────────────────────────────────────────

/**
 * Qué muestra el Panel, y —lo importante— QUIÉN lo está mirando.
 *
 * El identificador del usuario se saca de la sesión que Supabase deja en el
 * almacenamiento local. Se lee el `user.id` y nada más: ni el token, ni el
 * correo, ni el refresco. Sirve para una sola pregunta, que es la que importa:
 * ¿esta sesión es la de la identidad dedicada, o es la de una persona?
 */
async function inspeccionarPanel(pagina) {
  await pagina.waitForTimeout(2500);
  const texto = await pagina.locator('body').innerText().catch(() => '');
  const userId = await pagina.evaluate(() => {
    for (const clave of Object.keys(localStorage)) {
      if (!/supabase|sb-/i.test(clave)) continue;
      try {
        const guardado = JSON.parse(localStorage.getItem(clave) || 'null');
        const id = guardado?.user?.id || guardado?.currentSession?.user?.id;
        if (id) return String(id);
      } catch { /* la clave no era una sesión */ }
    }
    return '';
  }).catch(() => '');
  return {
    centroVisible: await pagina.locator('[data-business-ops-center]').count() > 0,
    pideIngreso: await pagina.locator('[data-production-auth-form="business"]').first().isVisible().catch(() => false),
    userId,
    texto: texto.slice(0, 400),
  };
}

/**
 * ¿Sirve esta sesión de Panel?
 *
 * La tercera comprobación es la que cierra un agujero real: si alguien dejara
 * ahí la sesión del DUEÑO —a mano, o con una herramienta vieja— el harness
 * seguiría funcionando, pero operando producción con privilegio de dueño en vez
 * del rol acotado que todo este diseño eligió. Se compara contra el
 * identificador que dejó el alta, y si no coincide se rehace la sesión.
 */
export function evaluarPanelAprovisionado(inspeccion, userIdEsperado = '') {
  if (inspeccion?.pideIngreso) {
    return { ok: false, codigo: 'PANEL_PIDE_INGRESO', mensaje: 'el Panel muestra la pantalla de ingreso' };
  }
  if (!inspeccion?.centroVisible) {
    return { ok: false, codigo: 'PANEL_SIN_CENTRO', mensaje: 'el Panel no dibujó el centro de operación' };
  }
  if (userIdEsperado && inspeccion?.userId && inspeccion.userId !== userIdEsperado) {
    return {
      ok: false,
      codigo: 'PANEL_IDENTIDAD_AJENA',
      mensaje: 'la sesión guardada del Panel no es la de la identidad dedicada: esta prueba no opera con la cuenta de una persona',
    };
  }
  return { ok: true, codigo: null, mensaje: '' };
}

/**
 * Entra al Panel con la identidad dedicada.
 *
 * La contraseña se lee del almacén del sistema y se escribe en el campo del
 * formulario. No se imprime, no se registra y no se escribe a ningún archivo:
 * lo único que sale de acá es «entró» o «no entró».
 */
async function ingresarAlPanel(pagina, { anotar }) {
  const credencial = leerSecreto(IDENTIDAD_PANEL.credencial);
  if (!credencial?.secreto) {
    throw new SesionImposible(
      'PANEL_SIN_CREDENCIAL',
      'no hay contraseña guardada para la identidad del Panel: corré scripts/e2e-production-sale/provisionar-identidad-panel.mjs',
    );
  }
  const correo = correoDelPanel();
  if (credencial.usuario && credencial.usuario.toLowerCase() !== correo) {
    throw new SesionImposible(
      'PANEL_CREDENCIAL_AJENA',
      `la credencial guardada es de ${credencial.usuario} y el contrato dice ${correo}`,
    );
  }

  anotar('panel: iniciando sesión con la identidad dedicada');
  const formulario = pagina.locator('[data-production-auth-form="business"]').first();
  await formulario.waitFor({ timeout: ESPERA_CORTA });
  await formulario.locator('input[name="email"]').fill(correo);
  await formulario.locator('input[name="password"]').fill(credencial.secreto);
  await formulario.locator('button[type="submit"], button:not([type])').first().click();
  await pagina.locator('[data-business-ops-center]').first().waitFor({ timeout: 60_000 });
}

export async function asegurarSesionPanel({ navegador, raiz, anotar = () => {} }) {
  const rutaEstado = path.join(raiz, RUTAS.sesionBusiness);
  const hayEstado = existsSync(rutaEstado);
  const esperado = leerJson(path.join(raiz, RUTAS_IDENTIDAD.panelIdentidad))?.userId || '';

  let contexto = await contextoPanel(navegador, { estado: hayEstado ? rutaEstado : null });
  let pagina = await abrir(contexto, '#business');
  let compuerta = evaluarPanelAprovisionado(await inspeccionarPanel(pagina), esperado);
  let reingresada = false;

  if (!compuerta.ok) {
    anotar(`panel: la sesión guardada no sirve (${compuerta.codigo}); se vuelve a entrar`);
    await contexto.close().catch(() => {});
    contexto = await contextoPanel(navegador, { estado: null });
    pagina = await abrir(contexto, '#business');
    await ingresarAlPanel(pagina, { anotar });
    compuerta = evaluarPanelAprovisionado(await inspeccionarPanel(pagina), esperado);
    reingresada = true;
    if (!compuerta.ok) {
      await contexto.close().catch(() => {});
      throw new SesionImposible(compuerta.codigo, `no se pudo abrir el Panel: ${compuerta.mensaje}`);
    }
  }

  await guardarEstado(contexto, rutaEstado);
  return { contexto, pagina, reingresada, rutaEstado };
}

/**
 * Guarda el estado del navegador. Se llama al abrir y al cerrar: el token que
 * quedó dentro del archivo tiene que ser el ÚLTIMO, no el primero.
 */
export async function guardarEstado(contexto, ruta) {
  mkdirSync(path.dirname(ruta), { recursive: true });
  const estado = await contexto.storageState();
  writeFileSync(ruta, `${JSON.stringify(estado, null, 2)}\n`);
  return { cookies: estado.cookies?.length || 0, origenes: estado.origins?.length || 0 };
}

export const fichaDelCliente = (raiz) => leerJson(path.join(raiz, RUTAS_IDENTIDAD.clienteIdentidad));
export const fichaDelPanel = (raiz) => leerJson(path.join(raiz, RUTAS_IDENTIDAD.panelIdentidad));
