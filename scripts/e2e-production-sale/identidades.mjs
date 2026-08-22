/*
 * QUIÉN ES QUIÉN EN UNA CORRIDA AUTOMÁTICA.
 *
 * Tres actores, tres formas distintas de existir, y ninguna de las tres usa la
 * cuenta personal del dueño:
 *
 *   · PANEL — una identidad dedicada, con correo y contraseña propios. La
 *     contraseña la genera la máquina, vive en el Credential Manager de Windows
 *     y ninguna persona la conoce ni la necesita.
 *
 *   · CLIENTE — una identidad ANÓNIMA de Supabase. No es una elección de este
 *     harness: la tienda no tiene registro de clientes, cada visitante recibe
 *     una identidad anónima cuando guarda algo. Por eso el cliente de prueba no
 *     tiene contraseña que guardar: lo que se conserva es el estado del
 *     navegador, y si se pierde se vuelve a fabricar solo.
 *
 *   · REPARTIDOR — la sesión que ya vive en el teléfono. No se toca, no se
 *     copia y no se recrea. El harness maneja la aplicación, no la cuenta.
 *
 * POR QUÉ EL PANEL VA CON ROL `admin` Y NO CON `owner` NI CON `staff`
 * ------------------------------------------------------------------
 * Se midieron los dos actos que la automatización necesita, en el servidor:
 *
 *   · `apply_inventory_movement` (recepción) acepta owner, admin y staff.
 *   · `set_commercial_product_publication` (publicar) acepta owner y admin.
 *
 * O sea que `staff` alcanza para recibir pero no para publicar, y publicar es
 * la mitad del trabajo. El rol más acotado que cubre las dos cosas es `admin`.
 *
 * La alternativa era escribir una RPC nueva a medida para que un `staff`
 * pudiera publicar. Se descartó: dejaría en producción, para siempre, una
 * función privilegiada más, creada para servir a una prueba. Un miembro con rol
 * `admin` no agrega superficie nueva —usa la que el producto ya tiene—, se
 * apaga con un solo `is_active = false`, y deja cada movimiento firmado con su
 * propio `operator_id`, así que en el ledger se distingue de un dedo humano.
 *
 * Lo único que `owner` puede y `admin` no es promover a otro owner o admin. Esa
 * diferencia es exactamente la que se quiere conservar.
 */
import path from 'node:path';

export const NEGOCIO_ID = '00000000-0000-4000-8000-000000000001';

/**
 * La identidad del Panel.
 *
 * El correo usa el sufijo `+` sobre la casilla del dueño, igual que el que ya
 * tiene el repartidor de producción (`...+rider@...`): entrega en la misma
 * casilla, es inequívoco a la vista y no inventa un dominio que nadie controle.
 */
export const IDENTIDAD_PANEL = Object.freeze({
  clave: 'business',
  nombreHumano: 'TABA Production E2E Operator',
  correoPorDefecto: 'jariel1970+e2e@gmail.com',
  variableCorreo: 'TABA2_E2E_BUSINESS_EMAIL',
  rol: 'admin',
  rolesProhibidos: Object.freeze(['owner']),
  credencial: 'business-operator',
});

/**
 * El perfil del cliente de prueba.
 *
 * El teléfono es de prueba a propósito: el pedido lo ve el Panel y lo ve quien
 * reparte, así que poner ahí el número personal de alguien sería publicar un
 * dato que la prueba no necesita. Se puede reemplazar por el propio con
 * `TABA2_E2E_CUSTOMER_PHONE` si en algún momento hace falta que el teléfono del
 * pedido sirva para llamar.
 */
export const IDENTIDAD_CLIENTE = Object.freeze({
  clave: 'customer',
  nombreHumano: 'Prueba E2E',
  variableNombre: 'TABA2_E2E_CUSTOMER_NAME',
  telefonoPorDefecto: '2990000000',
  variableTelefono: 'TABA2_E2E_CUSTOMER_PHONE',
});

/**
 * LA DIRECCIÓN DE PRUEBA.
 *
 * No se inventa. Es la única dirección con punto confirmado que el sistema ya
 * tiene, y el punto no lo puso este harness: lo confirmó una persona con GPS el
 * 2026-08-18, antes de que existiera esta automatización. Acá se declara para
 * que el bootstrap del cliente escriba EXACTAMENTE ese texto y confirme
 * EXACTAMENTE esa coordenada, en vez de fabricar una nueva.
 *
 * `metrosDePrecision` es lo que el navegador reporta como exactitud del GPS
 * simulado. Quince metros es lo que da un teléfono con buena señal; el servidor
 * rechaza precisiones absurdas, así que el número tiene que ser plausible.
 */
export const DIRECCION_DE_PRUEBA = Object.freeze({
  etiqueta: 'Casa',
  calle: 'Mendoza',
  numero: '851',
  ciudad: 'Neuquén Capital',
  textoEsperado: 'Mendoza 851',
  latitud: -38.951730,
  longitud: -68.065775,
  metrosDePrecision: 15,
  origen: 'confirmada por una persona el 2026-08-18; esta automatización la reutiliza, no la crea',
});

/** Dónde queda lo que una corrida necesita saber de sí misma entre corridas. */
export const RUTAS_IDENTIDAD = Object.freeze({
  directorio: '.local/e2e-auth',
  clienteIdentidad: '.local/e2e-auth/customer-identidad.json',
  panelIdentidad: '.local/e2e-auth/business-identidad.json',
});

export const correoDelPanel = (env = process.env) => String(
  env[IDENTIDAD_PANEL.variableCorreo] || IDENTIDAD_PANEL.correoPorDefecto,
).trim().toLowerCase();

export const nombreDelCliente = (env = process.env) => String(
  env[IDENTIDAD_CLIENTE.variableNombre] || IDENTIDAD_CLIENTE.nombreHumano,
).trim();

export const telefonoDelCliente = (env = process.env) => String(
  env[IDENTIDAD_CLIENTE.variableTelefono] || IDENTIDAD_CLIENTE.telefonoPorDefecto,
).replace(/\D/g, '');

export const rutaAbsoluta = (raiz, relativa) => path.join(raiz, relativa);

/**
 * La compuerta del rol: esta automatización no crea ni usa un `owner`.
 *
 * Se comprueba en el aprovisionamiento Y en cada corrida. Que el guion que
 * otorga el rol se niegue no alcanza: si alguien promoviera la identidad a mano
 * más tarde, la corrida siguiente tiene que frenar sola.
 */
export function evaluarRolDelPanel(rol) {
  const valor = String(rol || '').trim().toLowerCase();
  if (!valor) {
    return Object.freeze({
      ok: false,
      codigo: 'PANEL_SIN_ROL',
      mensaje: 'la identidad del Panel no es miembro del comercio: corré el aprovisionamiento',
    });
  }
  if (IDENTIDAD_PANEL.rolesProhibidos.includes(valor)) {
    return Object.freeze({
      ok: false,
      codigo: 'PANEL_ROL_EXCESIVO',
      mensaje: `la identidad del Panel tiene rol «${valor}»: esta automatización no opera con privilegio de dueño`,
    });
  }
  if (valor !== IDENTIDAD_PANEL.rol) {
    return Object.freeze({
      ok: false,
      codigo: 'PANEL_ROL_DISTINTO',
      mensaje: `la identidad del Panel tiene rol «${valor}» y el contrato dice «${IDENTIDAD_PANEL.rol}»`,
    });
  }
  return Object.freeze({ ok: true, codigo: null, mensaje: '' });
}

/**
 * La compuerta de la dirección, por IDENTIDAD.
 *
 * Antes esto comparaba textos: se leía lo que el checkout mostraba y se buscaba
 * una subcadena. Eso funciona hasta que alguien guarda «Mendoza 851 bis» y la
 * comparación laxa lo acepta como si fuera la misma puerta. La dirección tiene
 * un identificador estable en la base y el checkout lo escribe en el DOM
 * (`data-customer-address-id`), así que la comparación es por ese uuid y el
 * texto queda sólo para el informe.
 */
export function evaluarDireccionPorIdentidad({ idElegido, idAprobado, ubicacionConfirmada }) {
  if (!idAprobado) {
    return Object.freeze({
      ok: false,
      codigo: 'DIRECCION_SIN_APROVISIONAR',
      mensaje: 'no hay dirección de prueba registrada: corré el bootstrap del cliente',
    });
  }
  if (!idElegido) {
    return Object.freeze({
      ok: false,
      codigo: 'DIRECCION_AUSENTE',
      mensaje: 'el checkout no muestra ninguna dirección elegida',
    });
  }
  if (String(idElegido) !== String(idAprobado)) {
    return Object.freeze({
      ok: false,
      codigo: 'DIRECCION_DISTINTA',
      mensaje: 'la dirección elegida en el checkout no es la aprobada para la prueba',
    });
  }
  if (ubicacionConfirmada !== true) {
    return Object.freeze({
      ok: false,
      codigo: 'DIRECCION_SIN_PUNTO',
      mensaje: 'la dirección de prueba perdió su punto confirmado: sin punto no sale ningún repartidor',
    });
  }
  return Object.freeze({ ok: true, codigo: null, mensaje: '' });
}
