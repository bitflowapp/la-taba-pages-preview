import { webhookEventType, webhookResourceId } from './webhook-notification.ts';

const BASE = 'https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/mercadopago-webhook';
const at = (query: string) => new URL(`${BASE}${query}`);

Deno.test('notificacion moderna: data.id manda', () => {
  if (webhookResourceId(at('?data.id=123456&type=payment')) !== '123456') {
    throw new Error('no se leyo data.id');
  }
});

Deno.test('merchant order legacy: topic + id se resuelve', () => {
  if (webhookResourceId(at('?topic=merchant_order&id=987654')) !== '987654') {
    throw new Error('regresion: merchant_order quedaba sin recurso identificado');
  }
});

Deno.test('data.id gana sobre el id legacy si vienen los dos', () => {
  if (webhookResourceId(at('?data.id=111&topic=merchant_order&id=222')) !== '111') {
    throw new Error('el id legacy piso al data.id firmado');
  }
});

Deno.test('un id suelto sin topic no identifica recurso', () => {
  if (webhookResourceId(at('?id=999')) !== '') {
    throw new Error('un id sin topic se acepto como recurso');
  }
});

Deno.test('sin parametros no hay recurso', () => {
  if (webhookResourceId(at('')) !== '') throw new Error('recurso inventado');
});

Deno.test('tipo de evento: el cuerpo tiene prioridad sobre el query', () => {
  if (webhookEventType(at('?topic=merchant_order'), { type: 'payment' }) !== 'payment') {
    throw new Error('el query piso al tipo del cuerpo');
  }
  if (webhookEventType(at('?topic=merchant_order'), { topic: 'PAYMENT' }) !== 'payment') {
    throw new Error('no se normalizo el topic del cuerpo');
  }
});

Deno.test('tipo de evento: cae al topic del query cuando el cuerpo no lo trae', () => {
  if (webhookEventType(at('?topic=Merchant_Order&id=1'), {}) !== 'merchant_order') {
    throw new Error('no se resolvio el topic desde el query');
  }
  if (webhookEventType(at(''), {}) !== '') throw new Error('tipo inventado');
});
