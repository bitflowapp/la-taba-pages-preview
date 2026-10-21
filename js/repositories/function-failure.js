/**
 * `functions.invoke` de supabase-js devuelve `data: null` ante cualquier
 * respuesta que no sea 2xx y deja el cuerpo dentro de `error.context` (la
 * Response original). Sin leerlo, el panel contestaba lo mismo a «no sos el
 * dueño», «muchos intentos» o «hay cobros pendientes». Acá se recupera el código
 * y el cuerpo que mandó el servidor. Nunca lanza.
 */
export async function readFunctionFailure(error) {
  const response = error?.context;
  if (!response || typeof response.json !== 'function') return { code: '', status: 0, body: null };
  try {
    const source = typeof response.clone === 'function' ? response.clone() : response;
    const body = await source.json();
    return { code: String(body?.code || ''), status: Number(response.status) || 0, body: body && typeof body === 'object' ? body : null };
  } catch (_) {
    return { code: '', status: Number(response.status) || 0, body: null };
  }
}
