import assert from 'node:assert/strict';
import test from 'node:test';
import { cargarDatosReales, ESTADO_CATALOGO, evaluarCatalogo } from '../scripts/catalog-commercial-readiness.mjs';

// El validador cruza góndola, vitrina, propuesta de precios, manifiesto de imágenes y
// registro de autorizaciones. No aprueba nada: separa lo técnicamente completo de lo
// que espera una decisión del dueño. Estas pruebas fijan las dos mitades: que lo REAL
// pase limpio y que cada defecto concreto se detecte.

const real = await cargarDatosReales();
const clonar = (valor) => structuredClone(valor);

async function evaluarUno(sku, mutar) {
  const datos = { ...real, gondola: clonar(real.gondola.filter((g) => g.sku === sku)), vitrina: clonar(real.vitrina) };
  const { inspeccionar, leer } = real;
  const ajustes = { inspeccionar, leer, ...(mutar(datos) || {}) };
  const resultado = await evaluarCatalogo({ ...datos, ...ajustes });
  return resultado.filas[0];
}

test('la vitrina real: 52 SKU, 42 con foto y 10 sin foto, ningún defecto técnico', async () => {
  const resultado = await evaluarCatalogo(real);
  assert.equal(resultado.totalSku, 52);
  assert.equal(resultado.resumen.porEstado[ESTADO_CATALOGO.COMPLETO_CON_FOTO], 42);
  assert.equal(resultado.resumen.porEstado[ESTADO_CATALOGO.COMPLETO_SIN_FOTO], 10);
  assert.equal(resultado.resumen.defectosTecnicos, 0, resultado.filas.filter((f) => f.defectos.length).map((f) => `${f.sku}: ${f.defectos.join('; ')}`).join('\n'));
});

test('nada sale «listo para vender»: no existe aprobación por SKU del dueño', async () => {
  const resultado = await evaluarCatalogo(real);
  assert.equal(resultado.resumen.listosParaVender, 0);
  assert.equal(resultado.resumen.aprobacionComercialPendiente, 52);
  for (const fila of resultado.filas) {
    assert.equal(fila.listoParaVender, false);
    assert.ok(fila.pendientes.some((p) => /precio sin aprobación/.test(p)), `${fila.sku}: debería declarar el precio sin aprobar`);
  }
});

test('los precios vigentes se conservan: 32 se mantienen, 14 en conflicto de margen y 6 pendientes no se convierten en rebaja', async () => {
  const resultado = await evaluarCatalogo(real);
  const p = resultado.resumen.precios;
  assert.deepEqual([p.mantieneVigente, p.conflictoMargen, p.pendienteComparacion], [32, 14, 6]);
  for (const fila of resultado.filas) {
    const g = real.gondola.find((item) => item.sku === fila.sku);
    assert.equal(fila.precio.vigente, g.price, `${fila.sku}: el precio vigente no se toca`);
    if (fila.precio.propuestaEstado === 'conflicto_margen') assert.ok(fila.pendientes.some((x) => /conflicto de margen/.test(x)));
    // La propuesta no cambia ningún precio: o repite el vigente o no propone nada.
    assert.ok(fila.precio.propuestaPrecio === null || fila.precio.propuestaPrecio === fila.precio.vigente, `${fila.sku}: la propuesta no puede ser una rebaja automática`);
  }
  assert.ok(p.antiguedadCostoDias > 0, 'declara cuánto hace que se midió el costo');
});

test('un SKU sin foto queda COMPLETO_SIN_FOTO y se dice que muestra el placeholder', async () => {
  const fila = await evaluarUno('quilmes-clasica-lata-473ml', () => {});
  assert.equal(fila.estadoCatalogo, ESTADO_CATALOGO.COMPLETO_SIN_FOTO);
  assert.equal(fila.foto.estado, 'SIN_FOTO');
  assert.ok(fila.pendientes.some((x) => /sin foto autorizada/.test(x)));
});

test('detecta un precio de la vitrina distinto del de la góndola', async () => {
  const fila = await evaluarUno('coca-cola-original-2250ml', (d) => { d.vitrina.find((p) => p.sku === 'coca-cola-original-2250ml').price = 5800; });
  assert.equal(fila.estadoCatalogo, ESTADO_CATALOGO.DEFECTUOSO);
  assert.match(fila.defectos.join(' '), /precio de la vitrina 5800 ≠ góndola 5900/);
});

test('detecta un precio por debajo del piso de margen o fuera del múltiplo de $50', async () => {
  const fila = await evaluarUno('coca-cola-original-2250ml', (d) => {
    d.gondola[0].price = 5875;
    d.vitrina.find((p) => p.sku === 'coca-cola-original-2250ml').price = 5875;
    d.propuesta = { ...d.propuesta, filas: d.propuesta.filas.map((f) => (f.sku === 'coca-cola-original-2250ml' ? { ...f, precioVigenteTABA: 5875 } : f)) };
  });
  assert.match(fila.defectos.join(' '), /múltiplo de \$50/);
  assert.match(fila.defectos.join(' '), /por debajo del piso de margen/);
});

test('detecta identidad incompleta, pack incoherente y alcohol sin edad mínima', async () => {
  const sinContenido = await evaluarUno('coca-cola-original-2250ml', (d) => { d.gondola[0].capacityValue = 0; });
  assert.match(sinContenido.defectos.join(' '), /contenido neto inválido/);

  const packRoto = await evaluarUno('quilmes-clasica-lata-473ml-pack-6', (d) => { d.gondola[0].unitsPerPack = 1; });
  assert.match(packRoto.defectos.join(' '), /pack/);

  const alcoholSinEdad = await evaluarUno('quilmes-stout-lata-473ml', (d) => { d.gondola[0].minimumAge = 0; });
  assert.match(alcoholSinEdad.defectos.join(' '), /alcohol sin edad mínima de 18/);
});

test('detecta una foto cuyo archivo no coincide con el hash declarado', async () => {
  const fila = await evaluarUno('coca-cola-original-2250ml', () => ({
    leer: async (ruta) => Buffer.concat([await real.leer(ruta), Buffer.from('x')]),
  }));
  assert.equal(fila.foto.estado, 'DEFECTUOSA');
  assert.match(fila.defectos.join(' '), /el hash del archivo no coincide/);
});

test('detecta una foto pixelada o estirada', async () => {
  const chica = await evaluarUno('coca-cola-original-2250ml', () => ({ inspeccionar: async () => ({ width: 300, height: 300, format: 'webp' }) }));
  assert.match(chica.defectos.join(' '), /por debajo de 600px/);
  const estirada = await evaluarUno('coca-cola-original-2250ml', () => ({ inspeccionar: async () => ({ width: 1000, height: 700, format: 'webp' }) }));
  assert.match(estirada.defectos.join(' '), /no es cuadrado/);
});

test('detecta derechos que no habilitan, una referencia inexistente y un tipo de fuente fuera de alcance', async () => {
  const pendiente = await evaluarUno('coca-cola-original-2250ml', (d) => { d.vitrina.find((p) => p.sku === 'coca-cola-original-2250ml').rightsStatus = 'pending_review'; });
  assert.match(pendiente.defectos.join(' '), /no habilitan publicar/);

  const sinReferencia = await evaluarUno('coca-cola-original-2250ml', (d) => { d.vitrina.find((p) => p.sku === 'coca-cola-original-2250ml').imageRightsReference = 'TABA-AUT-0000'; });
  assert.match(sinReferencia.defectos.join(' '), /no existe en el registro de autorizaciones/);

  const fueraDeAlcance = await evaluarUno('coca-cola-original-2250ml', (d) => { d.vitrina.find((p) => p.sku === 'coca-cola-original-2250ml').imageSourceType = 'cadena_comercial_secundaria'; });
  assert.match(fueraDeAlcance.defectos.join(' '), /fuera del alcance/);
});

test('detecta un archivo de imagen que pertenece a otro SKU', async () => {
  const fila = await evaluarUno('coca-cola-original-2250ml', (d) => {
    const v = d.vitrina.find((p) => p.sku === 'coca-cola-original-2250ml');
    const otro = d.vitrina.find((p) => p.sku === 'coca-cola-zero-2250ml');
    v.image = otro.image;
    v.imageSha256 = otro.imageSha256;
  });
  assert.match(fila.defectos.join(' '), /el nombre del archivo no pertenece al SKU/);
});
