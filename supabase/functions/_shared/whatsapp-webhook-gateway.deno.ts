import {
  createGraphSender,
  extractMessages,
  handleWhatsAppWebhook,
  hmacSha256Hex,
  timingSafeEqual,
  verifyMetaSignature,
  type OutboundReply,
  type RpcResult,
  type SendResult,
} from './whatsapp-webhook-gateway.ts';

const SECRET = 'app-secret-de-prueba';
const VERIFY = 'verify-token-de-prueba';
const NUMBER = '109876543210';
const URL = 'https://example.invalid/functions/v1/whatsapp-webhook';
const encoder = new TextEncoder();

function fail(message: string): never {
  throw new Error(message);
}

function message(id: string, from: string, body: string) {
  return { from, id, timestamp: '1790000000', type: 'text', text: { body } };
}

function payload(...values: Array<Record<string, unknown>>) {
  return {
    object: 'whatsapp_business_account',
    entry: values.map((value, index) => ({ id: `waba-${index}`, changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: NUMBER }, ...value } }] })),
  };
}

async function signed(body: unknown, secret = SECRET, headers: Record<string, string> = {}): Promise<Request> {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const signature = `sha256=${await hmacSha256Hex(secret, encoder.encode(raw))}`;
  return new Request(URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature, ...headers }, body: raw });
}

function harness({ inbound, fail: failing = new Set<string>(), sendResult = { ok: true, providerMessageId: 'wamid.out' } }: {
  inbound?: (params: Record<string, unknown>) => unknown;
  fail?: Set<string>;
  sendResult?: SendResult;
} = {}) {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const sent: OutboundReply[] = [];
  const logs: Array<Record<string, unknown>> = [];
  let sequence = 0;
  return {
    calls,
    sent,
    logs,
    deps: {
      appSecret: SECRET,
      verifyToken: VERIFY,
      phoneNumberId: NUMBER,
      rpc: (name: string, params: Record<string, unknown>): Promise<RpcResult> => {
        calls.push({ name, params });
        if (name === 'whatsapp_handle_inbound') {
          if (failing.has(String(params.p_message_id))) return Promise.resolve({ data: null, error: { code: '40P01', message: 'deadlock' } });
          const data = inbound?.(params) ?? { duplicate: false, outcome: 'help', replies: [{ id: `out-${++sequence}`, kind: 'text', body: 'respuesta', to: params.p_phone }] };
          return Promise.resolve({ data, error: null });
        }
        if (name === 'whatsapp_pending_outbound') return Promise.resolve({ data: [], error: null });
        return Promise.resolve({ data: null, error: null });
      },
      send: (reply: OutboundReply) => {
        sent.push(reply);
        return Promise.resolve(sendResult);
      },
      log: (event: Record<string, unknown>) => logs.push(event),
    },
  };
}

Deno.test('HMAC-SHA256 correcto (vector conocido) y comparación en tiempo constante', async () => {
  const mac = await hmacSha256Hex('key', encoder.encode('The quick brown fox jumps over the lazy dog'));
  if (mac !== 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8') fail(`HMAC incorrecto: ${mac}`);
  if (!timingSafeEqual('abc', 'abc') || timingSafeEqual('abc', 'abd') || timingSafeEqual('abc', 'abcd') || timingSafeEqual('', 'a')) {
    fail('la comparación no distingue lo que tiene que distinguir');
  }
});

Deno.test('sin la firma de Meta con el App Secret, no se lee nada', async () => {
  const body = JSON.stringify(payload({ messages: [message('wamid.1', '5492995550001', 'estado')] }));
  const good = `sha256=${await hmacSha256Hex(SECRET, encoder.encode(body))}`;
  if (!(await verifyMetaSignature(encoder.encode(body), good, SECRET))) fail('una firma válida no pasó');
  if (!(await verifyMetaSignature(encoder.encode(body), good.toUpperCase().replace('SHA256=', 'sha256='), SECRET))) fail('el hex en mayúsculas es la misma firma');
  const other = `sha256=${await hmacSha256Hex('otro-secreto', encoder.encode(body))}`;
  for (const header of [null, '', good.replace('sha256=', 'sha1='), good.slice(0, -2), other, `sha256=${'0'.repeat(64)}`, ` ${good}x`]) {
    if (await verifyMetaSignature(encoder.encode(body), header, SECRET)) fail(`se aceptó la firma ${header}`);
  }
  if (await verifyMetaSignature(encoder.encode(body), good, '')) fail('sin App Secret configurado se tiene que fallar cerrado');
  // El cuerpo alterado después de firmar no pasa.
  if (await verifyMetaSignature(encoder.encode(body.replace('estado', 'facturar')), good, SECRET)) fail('se aceptó un cuerpo alterado');

  const { deps, calls } = harness();
  for (const request of [
    new Request(URL, { method: 'POST', body }),
    new Request(URL, { method: 'POST', body, headers: { 'x-hub-signature-256': other } }),
    new Request(URL, { method: 'POST', body: body.replace('estado', 'facturar'), headers: { 'x-hub-signature-256': good } }),
  ]) {
    const response = await handleWhatsAppWebhook(request, deps);
    if (response.status !== 401) fail(`una firma inválida respondió ${response.status}`);
  }
  if (calls.length !== 0) fail('con firma inválida se llamó a la base');
});

Deno.test('la verificación del webhook compara el verify token y devuelve solo un challenge válido', async () => {
  const { deps } = harness();
  const get = (query: string) => handleWhatsAppWebhook(new Request(`${URL}?${query}`), deps);
  const ok = await get(`hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1158201444`);
  if (ok.status !== 200 || (await ok.text()) !== '1158201444') fail('la verificación correcta no devolvió el challenge');
  for (const query of [
    `hub.mode=subscribe&hub.verify_token=otro&hub.challenge=1`,
    `hub.mode=unsubscribe&hub.verify_token=${VERIFY}&hub.challenge=1`,
    `hub.mode=subscribe&hub.challenge=1`,
    `hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=%3Cscript%3E`,
  ]) {
    if ((await get(query)).status !== 403) fail(`se aceptó la verificación ${query}`);
  }
  const noToken = await handleWhatsAppWebhook(new Request(`${URL}?hub.mode=subscribe&hub.verify_token=&hub.challenge=1`), { ...deps, verifyToken: '' });
  if (noToken.status !== 403) fail('sin verify token configurado se tiene que fallar cerrado');
});

Deno.test('se procesan TODAS las entradas y todos los mensajes, en orden; los estados se ignoran', async () => {
  const body = payload(
    { messages: [message('wamid.a1', '5492995550001', 'facturar LT-1'), message('wamid.a2', '5492995550001', 'si')], statuses: [{ id: 'wamid.x', status: 'read' }] },
    { messages: [message('wamid.b1', '5492995550002', 'estado')] },
    { statuses: [{ id: 'wamid.y', status: 'delivered' }] },
  );
  const { deps, calls, sent } = harness();
  const response = await handleWhatsAppWebhook(await signed(body), deps);
  if (response.status !== 200) fail(`respondió ${response.status}`);
  const handled = calls.filter((call) => call.name === 'whatsapp_handle_inbound');
  const order = handled.map((call) => `${call.params.p_message_id}:${call.params.p_text}`).join(',');
  if (order !== 'wamid.a1:facturar LT-1,wamid.a2:si,wamid.b1:estado') fail(`orden o mensajes incorrectos: ${order}`);
  if (handled[0].params.p_message_timestamp !== new Date(1790000000 * 1000).toISOString()) fail('la hora del mensaje no se convirtió');
  if (handled.some((call) => call.params.p_phone_number_id !== NUMBER || call.params.p_message_type !== 'text')) fail('metadatos incorrectos');
  if (sent.length !== 3) fail(`se enviaron ${sent.length} respuestas`);
  const marks = calls.filter((call) => call.name === 'whatsapp_mark_outbound');
  if (marks.length !== 3 || marks.some((mark) => mark.params.p_status !== 'sent' || mark.params.p_provider_message_id !== 'wamid.out')) fail('no se marcó lo enviado');
});

Deno.test('botones y listas se tratan como el texto que eligió la persona; otros tipos llegan como tales', () => {
  const messages = extractMessages(payload({
    messages: [
      { from: '5492995550001', id: 'wamid.i1', timestamp: '1790000000', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'si', title: 'SI' } } },
      { from: '5492995550001', id: 'wamid.i2', timestamp: '1790000000', type: 'button', button: { text: 'NO', payload: 'no' } },
      { from: '5492995550001', id: 'wamid.i3', timestamp: '1790000000', type: 'image', image: { id: 'media' } },
    ],
  }));
  const seen = messages.map((item) => `${item.type}:${item.text}`).join(',');
  if (seen !== 'text:SI,text:NO,image:null') fail(`tipos incorrectos: ${seen}`);
  if (extractMessages({ object: 'page', entry: [] }).length !== 0) fail('un objeto que no es de WhatsApp se procesó');
  if (extractMessages('basura').length !== 0) fail('un cuerpo inválido se procesó');
});

Deno.test('un duplicado no se contesta; otro número de WhatsApp no se atiende', async () => {
  const body = payload(
    { messages: [message('wamid.d1', '5492995550001', 'si')] },
  );
  const foreign = { ...body, entry: [...body.entry, { id: 'x', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '999' }, messages: [message('wamid.f1', '5492995550009', 'estado')] } }] }] };
  const { deps, calls, sent } = harness({ inbound: () => ({ duplicate: true, replies: [] }) });
  const response = await handleWhatsAppWebhook(await signed(foreign), deps);
  const json = await response.json();
  if (response.status !== 200 || json.duplicates !== 1 || json.processed !== 0) fail(`respuesta: ${JSON.stringify(json)}`);
  if (sent.length !== 0) fail('se contestó un duplicado');
  if (calls.some((call) => call.params.p_message_id === 'wamid.f1')) fail('se atendió un mensaje de otro número');
});

Deno.test('si un mensaje no quedó en la base, 500 para que Meta reintente; lo demás sí se contesta', async () => {
  const body = payload({ messages: [message('wamid.e1', '5492995550001', 'estado'), message('wamid.e2', '5492995550001', 'ayuda')] });
  const { deps, sent, logs } = harness({ fail: new Set(['wamid.e1']) });
  const response = await handleWhatsAppWebhook(await signed(body), deps);
  const json = await response.json();
  if (response.status !== 500 || json.failures !== 1 || json.processed !== 1) fail(`respuesta: ${response.status} ${JSON.stringify(json)}`);
  if (sent.length !== 1) fail('la respuesta del mensaje que sí se procesó no salió');
  if (JSON.stringify(logs).includes('estado') || JSON.stringify(logs).includes('5492995550001')) fail('el log trae texto o el número completo');
});

Deno.test('un envío fallido queda marcado para reintentar y no provoca reintento de Meta', async () => {
  const body = payload({ messages: [message('wamid.s1', '5492995550001', 'ayuda')] });
  const { deps, calls } = harness({ sendResult: { ok: false, error: 'graph_503' } });
  const response = await handleWhatsAppWebhook(await signed(body), deps);
  if (response.status !== 200) fail(`respondió ${response.status}`);
  const mark = calls.find((call) => call.name === 'whatsapp_mark_outbound');
  if (mark?.params.p_status !== 'failed' || mark.params.p_error !== 'graph_503') fail(`marca: ${JSON.stringify(mark)}`);
  if (!calls.some((call) => call.name === 'whatsapp_pending_outbound')) fail('no se reintentan los pendientes');
});

Deno.test('cuerpo inválido, demasiado grande o método ajeno', async () => {
  const { deps } = harness();
  if ((await handleWhatsAppWebhook(await signed('{no es json'), deps)).status !== 400) fail('JSON inválido');
  const big = JSON.stringify({ object: 'whatsapp_business_account', relleno: 'x'.repeat(300 * 1024) });
  if ((await handleWhatsAppWebhook(await signed(big), deps)).status !== 413) fail('cuerpo demasiado grande');
  if ((await handleWhatsAppWebhook(new Request(URL, { method: 'PUT', body: '{}' }), deps)).status !== 405) fail('método ajeno');
});

Deno.test('el envío por la Graph API: texto sin vista previa, PDF por su ruta privada firmada', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const signed: string[] = [];
  let status = 200;
  let artifact: RpcResult = { data: { bucket: 'fiscal-documents', storage_path: 'fiscal/b/d/t.pdf', filename: 'comprobante-00006-00000001.pdf' }, error: null };
  const send = createGraphSender({
    graphApiVersion: 'v99.0',
    phoneNumberId: NUMBER,
    accessToken: 'token-de-prueba',
    fetch: (url, init) => {
      requests.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify(status === 200 ? { messages: [{ id: 'wamid.enviado' }] } : { error: { code: 131047 } }), { status }));
    },
    rpc: (name, params) => {
      rpcCalls.push({ name, params });
      return Promise.resolve(artifact);
    },
    signArtifactUrl: (bucket, path) => {
      signed.push(`${bucket}/${path}`);
      return Promise.resolve(`https://storage.invalid/sign/${path}?token=corto`);
    },
  });
  const textResult = await send({ id: 'out-1', kind: 'text', body: 'Solicitud recibida.', to: '5492995550001' });
  if (!textResult.ok || textResult.providerMessageId !== 'wamid.enviado') fail(`texto: ${JSON.stringify(textResult)}`);
  const first = JSON.parse(String(requests[0].init.body));
  if (requests[0].url !== `https://graph.facebook.com/v99.0/${NUMBER}/messages`) fail(`URL: ${requests[0].url}`);
  if ((requests[0].init.headers as Record<string, string>).authorization !== 'Bearer token-de-prueba') fail('sin credencial de Meta');
  if (first.type !== 'text' || first.text.body !== 'Solicitud recibida.' || first.text.preview_url !== false || first.to !== '5492995550001') fail(`cuerpo: ${JSON.stringify(first)}`);

  const documentResult = await send({ id: 'out-2', kind: 'document', body: 'Comprobante del pedido LT-1', artifact_id: 'a', to: '5492995550001' });
  const second = JSON.parse(String(requests[1].init.body));
  if (!documentResult.ok || rpcCalls[0]?.params.p_outbound_id !== 'out-2' || signed[0] !== 'fiscal-documents/fiscal/b/d/t.pdf') fail('el PDF no salió de la ruta del artefacto');
  if (second.type !== 'document' || second.document.link !== 'https://storage.invalid/sign/fiscal/b/d/t.pdf?token=corto'
      || second.document.filename !== 'comprobante-00006-00000001.pdf' || second.document.caption !== 'Comprobante del pedido LT-1') fail(`documento: ${JSON.stringify(second)}`);

  artifact = { data: null, error: { code: 'P0002', message: 'comprobante no disponible' } };
  const missing = await send({ id: 'out-3', kind: 'document', body: 'x', artifact_id: 'a', to: '5492995550001' });
  if (missing.ok || missing.error !== 'artifact_unavailable' || requests.length !== 2) fail('sin artefacto no se manda nada');
  status = 400;
  const refused = await send({ id: 'out-4', kind: 'text', body: 'x', to: '5492995550001' });
  if (refused.ok || refused.error !== 'graph_400') fail(`un rechazo de Meta: ${JSON.stringify(refused)}`);
});
