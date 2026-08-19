/*
 * Quién puede operar el catálogo, según el MISMO contrato que aplica la base.
 *
 * POR QUÉ ESTO ES UN ARCHIVO APARTE
 * ---------------------------------
 * Porque la decisión tiene que poder probarse sin red, sin sesión y sin base, y
 * porque escribirla dos veces es la forma de que las dos versiones se separen.
 * La autoridad sigue siendo la base: acá sólo se interpreta lo que la base
 * respondió.
 *
 * EL CONTRATO, COPIADO DE DONDE VIVE
 * ----------------------------------
 * Las cinco RPC de catálogo —register_catalog_assets, stage_catalog_products,
 * import_catalog_batch, publish_catalog_product y unpublish_catalog_product—
 * hacen todas exactamente lo mismo:
 *
 *     if auth.uid() is null
 *        or not public.has_business_role(p_business_id, array['owner', 'admin'])
 *     then raise exception 'Only an active owner/admin can ...';
 *
 * Son DOS roles, no uno. El Panel usa la misma pareja
 * (`['owner','admin'].includes(access.membership?.role)`) para sus operaciones
 * privilegiadas. Cualquier comprobación previa que pida menos que eso rechaza
 * gente que la base sí acepta, y cualquiera que pida más la deja entrar donde la
 * base la va a frenar igual. Las dos formas de equivocarse son malas; la primera
 * además es invisible hasta que alguien no puede trabajar.
 *
 * POR QUÉ SE PREGUNTA POR EL ROL Y NO POR UN BOOLEANO
 * --------------------------------------------------
 * `has_business_role` devuelve true/false y no dice por qué. `identity_member_role`
 * devuelve el rol, o null. Con el rol en la mano el mensaje de error puede decir
 * «sos staff y esto pide owner o admin» en vez de «no autorizado», que es la clase
 * de mensaje que hace perder una tarde.
 */

/** Los roles que el backend acepta para operar el catálogo. */
export const ROLES_CATALOGO = Object.freeze(['owner', 'admin']);

/** Todos los roles que `business_members` admite hoy. */
export const ROLES_CONOCIDOS = Object.freeze(['owner', 'admin', 'staff', 'rider']);

/*
 * `identity_member_role` devuelve null en SEIS situaciones distintas y a
 * propósito no las distingue: quien pregunta desde afuera no tiene por qué
 * enterarse de si la membresía no existe, está inactiva, es de otro negocio, el
 * usuario está deshabilitado, la sesión fue revocada o —la que más sorprende— la
 * sesión nunca se registró. Para el que consulta son el mismo no.
 *
 * Este mensaje enumera las seis para que quien lea el error sepa dónde mirar, sin
 * que el código pretenda saber cuál fue.
 */
const SIN_ROL = [
  'la base no reconoce ningún rol para esta sesión en este negocio.',
  'El contrato colapsa seis causas en la misma respuesta:',
  '  1. no hay fila en business_members;',
  '  2. la hay pero con is_active = false;',
  '  3. es de otro negocio;',
  '  4. el usuario está deshabilitado (identity_user_security.disabled_at);',
  '  5. la sesión fue revocada;',
  '  6. la sesión NUNCA SE REGISTRÓ con identity_register_session.',
  'La 6 es la que agarra a cualquier herramienta que entra por la API y no hace',
  'lo que hace el Panel al iniciar sesión.',
].join('\n        ');

/**
 * Decide si un rol devuelto por la base habilita a operar el catálogo.
 * `rol` es lo que `identity_member_role` devolvió: un rol, null o vacío.
 */
export function autorizaCatalogo(rol) {
  const normalizado = typeof rol === 'string' ? rol.trim().toLowerCase() : null;

  if (!normalizado) {
    return { autorizado: false, motivo: SIN_ROL, rol: null };
  }
  if (ROLES_CATALOGO.includes(normalizado)) {
    return { autorizado: true, motivo: `rol ${normalizado}, que es de los que operan el catálogo`, rol: normalizado };
  }
  if (ROLES_CONOCIDOS.includes(normalizado)) {
    return {
      autorizado: false,
      motivo: `el rol es ${normalizado} y esta operación pide ${ROLES_CATALOGO.join(' o ')}.`,
      rol: normalizado,
    };
  }
  return {
    autorizado: false,
    motivo: `la base devolvió un rol que este guion no conoce (${normalizado}). No se asume nada.`,
    rol: normalizado,
  };
}
