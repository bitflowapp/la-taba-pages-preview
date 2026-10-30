// PostgREST may cap even successful reads. A truncated financial report cannot authorize a pilot.
export async function leerCompleto(query, label) {
  const { data, error, count } = await query;
  if (error) throw Error(`no se pudo leer ${label} (${error.code || 'sin código'})`);
  if (!Array.isArray(data) || !Number.isSafeInteger(count) || count !== data.length) {
    throw Error(`lectura incompleta de ${label}; no se certifica ni autoriza`);
  }
  return data;
}
