import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buttonsMessage,
  clamp,
  LIMITS,
  listMessage,
  money,
  textMessage,
} from '../supabase/functions/_shared/whatsapp/messages.js';

const WA_ID = '5492995550101';

test('el mensaje de texto respeta el envoltorio de la Cloud API', () => {
  const message = textMessage(WA_ID, 'Hola');
  assert.equal(message.messaging_product, 'whatsapp');
  assert.equal(message.recipient_type, 'individual');
  assert.equal(message.to, WA_ID);
  assert.equal(message.text.body, 'Hola');
  assert.equal(message.text.preview_url, false);
});

test('un texto larguísimo se recorta antes de llegar a Meta', () => {
  const message = textMessage(WA_ID, 'x'.repeat(LIMITS.TEXT_BODY + 500));
  assert.equal(message.text.body.length, LIMITS.TEXT_BODY);
  assert.ok(message.text.body.endsWith('…'));
});

test('la lista nunca supera diez filas aunque le pasen cuarenta', () => {
  const message = listMessage(WA_ID, {
    body: 'Elegí',
    button: 'Ver',
    sections: [
      { title: 'A', rows: Array.from({ length: 25 }, (_, index) => ({ id: `p:${index}`, title: `Producto ${index}` })) },
      { title: 'B', rows: Array.from({ length: 25 }, (_, index) => ({ id: `q:${index}`, title: `Otro ${index}` })) },
    ],
  });
  const rows = message.interactive.action.sections.flatMap((section) => section.rows);
  assert.equal(rows.length, LIMITS.LIST_ROWS);
  assert.equal(message.interactive.action.sections.length, 1);
});

test('los títulos y descripciones de fila se recortan a lo que la API acepta', () => {
  const message = listMessage(WA_ID, {
    header: 'h'.repeat(120),
    body: 'b',
    footer: 'f'.repeat(120),
    button: 'botón larguísimo que no entra',
    sections: [{
      title: 'sección con un título excesivamente largo',
      rows: [{ id: 'p:1', title: 'Un nombre de producto larguísimo', description: 'd'.repeat(200) }],
    }],
  });
  const interactive = message.interactive;
  assert.ok(interactive.header.text.length <= LIMITS.HEADER);
  assert.ok(interactive.footer.text.length <= LIMITS.FOOTER);
  assert.ok(interactive.action.button.length <= LIMITS.LIST_BUTTON);
  assert.ok(interactive.action.sections[0].title.length <= LIMITS.ROW_TITLE);
  assert.ok(interactive.action.sections[0].rows[0].title.length <= LIMITS.ROW_TITLE);
  assert.ok(interactive.action.sections[0].rows[0].description.length <= LIMITS.ROW_DESCRIPTION);
});

test('una fila sin id o sin título se descarta en vez de viajar rota', () => {
  const message = listMessage(WA_ID, {
    body: 'b',
    sections: [{ title: 'A', rows: [{ id: '', title: 'sin id' }, { id: 'p:1', title: '' }, { id: 'p:2', title: 'ok' }] }],
  });
  assert.deepEqual(message.interactive.action.sections[0].rows.map((row) => row.id), ['p:2']);
});

test('una sección que quedó sin filas no se manda vacía', () => {
  const message = listMessage(WA_ID, {
    body: 'b',
    sections: [{ title: 'Vacía', rows: [] }, { title: 'Con algo', rows: [{ id: 'p:1', title: 'ok' }] }],
  });
  assert.equal(message.interactive.action.sections.length, 1);
  assert.equal(message.interactive.action.sections[0].title, 'Con algo');
});

test('los botones de respuesta se limitan a tres y a veinte caracteres', () => {
  const message = buttonsMessage(WA_ID, {
    body: 'b',
    buttons: [
      { id: 'act:pay', title: 'Pagar con Mercado Pago ahora mismo' },
      { id: 'act:menu', title: 'Seguir' },
      { id: 'act:clear', title: 'Vaciar' },
      { id: 'act:help', title: 'Ayuda' },
    ],
  });
  const buttons = message.interactive.action.buttons;
  assert.equal(buttons.length, LIMITS.REPLY_BUTTONS);
  assert.ok(buttons.every((button) => button.reply.title.length <= LIMITS.BUTTON_TITLE));
  assert.equal(buttons[0].type, 'reply');
});

test('los pesos se escriben como en el resto de TABA2', () => {
  assert.equal(money(19800), '$ 19.800');
  assert.equal(money(11900), '$ 11.900');
  assert.equal(money(1500.5), '$ 1.500,50');
  assert.equal(money(0), '$ 0');
  assert.equal(money('no es un número'), '$ 0');
});

test('el recorte colapsa espacios y no corta a la mitad de una elipsis', () => {
  assert.equal(clamp('  hola   mundo  ', 20), 'hola mundo');
  assert.equal(clamp('hola mundo', 6), 'hola…');
  assert.equal(clamp(null, 10), '');
});
