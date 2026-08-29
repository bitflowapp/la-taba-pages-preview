import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aplicarReconciliacion,
  huellaDeMarcado,
  leerTarjetasDelDom,
  planTrayReconciliation,
} from '../js/business/business-tray-patch.js';

const tarjeta = (clave, huella = `h-${clave}`) => ({ clave, huella });
const claves = (lista) => lista.map((item) => item.clave);

test('sin cambios no hay ninguna operación', () => {
  const actuales = [tarjeta('a'), tarjeta('b'), tarjeta('c')];
  const { operaciones, resumen } = planTrayReconciliation(actuales, actuales);

  assert.deepEqual(operaciones, []);
  assert.equal(resumen.intactas, 3);
  assert.equal(resumen.reemplazadas, 0);
});

test('un solo pedido que cambia reemplaza UNA tarjeta y deja las demás intactas', () => {
  // Es la medida del trabajo: con 300 pedidos en la bandeja, que cambie uno no
  // puede costar 300 reemplazos.
  const actuales = Array.from({ length: 300 }, (_, i) => tarjeta(`p${i}`));
  const deseados = actuales.map((item) => (
    item.clave === 'p150' ? tarjeta('p150', 'h-p150-nueva') : item
  ));

  const { operaciones, resumen } = planTrayReconciliation(actuales, deseados);

  assert.deepEqual(operaciones, [{ tipo: 'reemplazar', clave: 'p150' }]);
  assert.equal(resumen.reemplazadas, 1);
  assert.equal(resumen.intactas, 299);
});

test('un pedido nuevo se inserta en su posición sin tocar los que ya estaban', () => {
  const actuales = [tarjeta('a'), tarjeta('c')];
  const deseados = [tarjeta('a'), tarjeta('b'), tarjeta('c')];

  const { operaciones, resumen } = planTrayReconciliation(actuales, deseados);

  assert.deepEqual(operaciones, [{ tipo: 'insertar', clave: 'b', antes: 'c' }]);
  assert.equal(resumen.insertadas, 1);
  assert.equal(resumen.intactas, 2);
});

test('un pedido nuevo al final se inserta sin ancla', () => {
  const { operaciones } = planTrayReconciliation([tarjeta('a')], [tarjeta('a'), tarjeta('b')]);
  assert.deepEqual(operaciones, [{ tipo: 'insertar', clave: 'b', antes: null }]);
});

test('un pedido que sale de la bandeja se quita y nada más', () => {
  const { operaciones, resumen } = planTrayReconciliation(
    [tarjeta('a'), tarjeta('b'), tarjeta('c')],
    [tarjeta('a'), tarjeta('c')],
  );

  assert.deepEqual(operaciones, [{ tipo: 'quitar', clave: 'b' }]);
  assert.equal(resumen.quitadas, 1);
  assert.equal(resumen.intactas, 2);
});

test('un cambio de estado que reordena la bandeja mueve una sola tarjeta', () => {
  // Aceptar un pedido lo baja de sección: la bandeja se ordena por urgencia.
  const actuales = [tarjeta('a'), tarjeta('b'), tarjeta('c'), tarjeta('d')];
  const deseados = [tarjeta('b'), tarjeta('c'), tarjeta('d'), tarjeta('a', 'h-a-nueva')];

  const { operaciones, resumen } = planTrayReconciliation(actuales, deseados);

  assert.deepEqual(operaciones, [
    { tipo: 'reemplazar', clave: 'a' },
    { tipo: 'mover', clave: 'a', antes: null },
  ]);
  assert.equal(resumen.movidas, 1, 'las otras tres quedaron corridas, no movidas');
});

test('un pedido que baja de sección con 500 en la bandeja mueve UNA tarjeta', () => {
  /*
   * Es el caso medido con el navegador: con 500 pedidos, aceptar uno lo saca de
   * «Nuevos» y lo mete 165 posiciones más abajo. La versión ingenua de este
   * plan movía las 166 tarjetas desplazadas; sólo una se movió de verdad.
   */
  const actuales = Array.from({ length: 500 }, (_, i) => tarjeta(`p${i}`));
  const deseados = [
    ...actuales.slice(1, 166),
    tarjeta('p0', 'h-p0-nueva'),
    ...actuales.slice(166),
  ];

  const { operaciones, resumen } = planTrayReconciliation(actuales, deseados);

  assert.equal(resumen.movidas, 1);
  assert.equal(resumen.reemplazadas, 1);
  assert.equal(resumen.intactas, 499);
  assert.deepEqual(
    operaciones.filter((operacion) => operacion.tipo === 'mover'),
    [{ tipo: 'mover', clave: 'p0', antes: 'p166' }],
  );
});

test('el plan aplicado deja el contenedor exactamente en el orden pedido', () => {
  // Prueba de propiedad: cien barajadas al azar, cada una con altas y bajas.
  const documento = crearDocumentoFalso();
  let semilla = 20260828;
  const azar = () => {
    semilla = (semilla * 1103515245 + 12345) % 2147483648;
    return semilla / 2147483648;
  };

  for (let vuelta = 0; vuelta < 100; vuelta += 1) {
    const universo = Array.from({ length: 12 }, (_, i) => `k${i}`);
    const actuales = universo.filter(() => azar() < 0.7).map((clave) => tarjeta(clave));
    const deseados = universo
      .filter(() => azar() < 0.7)
      .sort(() => azar() - 0.5)
      .map((clave) => tarjeta(clave, azar() < 0.3 ? `h-${clave}-nueva` : `h-${clave}`));

    const contenedor = documento.crearContenedor(actuales.map((item) => item.clave));
    const { operaciones } = planTrayReconciliation(actuales, deseados);
    aplicarReconciliacion(contenedor, operaciones, {
      marcadoPorClave: (clave) => `<article data-order-card="${clave}"></article>`,
    });

    assert.deepEqual(
      claves(leerTarjetasDelDom(contenedor, new Map())),
      claves(deseados),
      `vuelta ${vuelta}: el DOM no quedó en el orden pedido`,
    );
  }
});

test('una clave repetida en el destino no duplica la tarjeta', () => {
  const { operaciones, resumen } = planTrayReconciliation(
    [tarjeta('a')],
    [tarjeta('a'), tarjeta('a', 'h-otra')],
  );
  assert.deepEqual(operaciones, []);
  assert.equal(resumen.total, 1);
});

test('la huella distingue marcados distintos y sobrevive al mismo contenido', () => {
  assert.equal(huellaDeMarcado('<article>uno</article>'), huellaDeMarcado('<article>uno</article>'));
  assert.notEqual(huellaDeMarcado('<article>uno</article>'), huellaDeMarcado('<article>dos</article>'));
  // Dos marcados de largo distinto no pueden colisionar: el largo entra en la
  // huella.
  assert.notEqual(huellaDeMarcado('a'), huellaDeMarcado('ab'));
  assert.equal(huellaDeMarcado(''), huellaDeMarcado(null));
});

test('la lista vacía y la lista sin destino no rompen el plan', () => {
  assert.deepEqual(planTrayReconciliation([], []).operaciones, []);
  assert.deepEqual(
    planTrayReconciliation([tarjeta('a'), tarjeta('b')], []).operaciones,
    [{ tipo: 'quitar', clave: 'a' }, { tipo: 'quitar', clave: 'b' }],
  );
  assert.deepEqual(planTrayReconciliation(undefined, undefined).operaciones, []);
});

/*
 * Un DOM mínimo: sólo lo que usa `aplicarReconciliacion`. El proyecto no tiene
 * jsdom y no vale la pena agregarlo por ocho métodos; el camino real con un
 * navegador de verdad lo cubre la prueba de Playwright.
 */
function crearDocumentoFalso() {
  class Nodo {
    constructor(documento, atributos = {}) {
      this.ownerDocument = documento;
      this.atributos = { ...atributos };
      this.children = [];
      this.parentNode = null;
    }

    getAttribute(nombre) { return this.atributos[nombre] ?? null; }

    set innerHTML(texto) {
      this.children = [];
      for (const match of String(texto).matchAll(/data-order-card="([^"]+)"/g)) {
        const hijo = new Nodo(this.ownerDocument, { 'data-order-card': match[1] });
        hijo.parentNode = this;
        this.children.push(hijo);
      }
    }

    get content() { return this; }

    get firstElementChild() { return this.children[0] || null; }

    insertBefore(nodo, ancla) {
      const actual = this.children.indexOf(nodo);
      if (actual !== -1) this.children.splice(actual, 1);
      const posicion = ancla ? this.children.indexOf(ancla) : -1;
      if (posicion === -1) this.children.push(nodo);
      else this.children.splice(posicion, 0, nodo);
      nodo.parentNode = this;
      return nodo;
    }

    remove() {
      const posicion = this.parentNode?.children.indexOf(this) ?? -1;
      if (posicion !== -1) this.parentNode.children.splice(posicion, 1);
      this.parentNode = null;
    }

    replaceWith(nodo) {
      const posicion = this.parentNode?.children.indexOf(this) ?? -1;
      if (posicion === -1) return;
      this.parentNode.children.splice(posicion, 1, nodo);
      nodo.parentNode = this.parentNode;
      this.parentNode = null;
    }
  }

  const documento = {
    createElement: () => new Nodo(documento),
    importNode: (nodo) => nodo,
    crearContenedor(clavesIniciales) {
      const contenedor = new Nodo(documento);
      contenedor.innerHTML = clavesIniciales
        .map((clave) => `<article data-order-card="${clave}"></article>`).join('');
      return contenedor;
    },
  };
  return documento;
}
