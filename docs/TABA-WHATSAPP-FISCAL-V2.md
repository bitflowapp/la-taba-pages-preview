# La Taba · WhatsApp como canal fiscal (V2)

Rama `feat/taba-whatsapp-fiscal-v2`, apilada sobre `feat/taba-commercial-fiscal-v2`. Reemplaza el
enfoque de #107, que no se continúa: #107 no se cierra, queda como referencia.

Estado honesto:

- Probado contra el esquema real de La Taba en PostgreSQL 17 local con el shim de Supabase
  (PG17+shim).
- ARCA es FakeArca del core: toda autorización es SIMULADA.
- La Graph API de Meta es un doble.
- **REAL_META: NOT_VERIFIED.** No hay número de WhatsApp Business, App Secret ni token reales, y
  nadie mandó un mensaje por WhatsApp de verdad.

## 1. Qué hace y qué no

WhatsApp **no decide nada fiscal**. Una persona del back office pide la factura de un pedido y la
confirma con un SI. La base pide exactamente lo mismo que el Panel, por la entrada de servidor
`service_request_order_invoice`, con esa persona como actor y el canal `WHATSAPP`. Si el pedido no
se puede facturar, contesta las mismas razones que el Panel.

```
Meta ── POST firmado ──► whatsapp-webhook (Edge Function, verify_jwt = false)
                           · X-Hub-Signature-256 con el App Secret, antes de leer nada
                           · todos los mensajes del lote, en orden
                           ▼
                 public.whatsapp_handle_inbound  (service_role, UNA transacción por mensaje)
                           · dedup por wa_message_id
                           · vínculo válido HOY (membresía revalidada)
                           · comando → respuestas en whatsapp_outbound_messages
                           · SI → public.service_request_order_invoice → evaluación única → core
                           ▼
whatsapp-webhook ── Graph API ──► respuestas (texto; el PDF por URL firmada del artefacto)
```

No hace:

- avisar solo cuando ARCA autoriza. Hay que preguntar con `estado <pedido>`;
- facturar ventas de mostrador ni notas de crédito;
- entender audio o imágenes;
- operar para clientes: es un canal del equipo del negocio.

## 2. Comandos

Son deterministas: sin IA ni interpretación libre. No distinguen mayúsculas ni acentos.

| Mensaje | Qué hace |
|---|---|
| `vincular ABCD-EFGH-JKLM` | canjea el código generado en el Panel |
| `facturar LT-1234` | evalúa el pedido. Si se puede facturar, pide confirmación con cliente, monto y ambiente; vence en 5 minutos |
| `facturar LT-1234 e imprimir` | lo mismo, y el ticket se imprime al autorizarse (pedido de impresión durable) |
| `SI` / `SI LT-1234` | confirma la confirmación abierta de ese teléfono. Responde "Solicitud recibida": nunca da por emitido lo que ARCA no autorizó |
| `NO` | cancela la confirmación abierta |
| `estado LT-1234` | estado real del comprobante. Si está autorizado, manda también el PDF vigente |
| `pendientes` | comprobantes en curso o a revisar, y pedidos que el servidor evalúa listos |
| `ventas hoy` | pedidos online del día sin cancelados, ventas de mostrador y comprobantes autorizados: datos reales |
| `estado` | ambiente fiscal, política, PC de impresión y cola |
| `negocio`, `negocio 2`, `negocio <slug>` | elegir el negocio cuando el teléfono está vinculado a más de uno |
| `ayuda` | la lista |

Un código con sintaxis rara (`LT-1,status.eq.x`) no pasa el formato del comando y nunca llega a
una consulta. Todo va como parámetro de una RPC; no se arma ninguna URL de PostgREST.

## 3. Vincular un teléfono

1. En el Panel, **Comprobantes › WhatsApp de facturación › Generar código para mi WhatsApp**.
2. Desde ese teléfono se manda `vincular ABCD-EFGH-JKLM` al número de WhatsApp Business del negocio.

El número lo da Meta, dentro del cuerpo firmado: nadie lo escribe.

- **El código.**
  - Tiene un selector de 4 caracteres y un secreto de 8, de un alfabeto sin 0/O ni 1/I.
  - Del secreto se guarda solo el hash.
  - Vence en 10 minutos y sirve una vez.
  - Pedir uno nuevo anula el anterior de esa persona en ese negocio.
- **Límites.**
  - 5 secretos equivocados anulan el código.
  - 10 fallas en una hora bloquean al teléfono una hora.
  - Diez teléfonos canjeando el mismo código a la vez: se vincula uno solo.
- **Un teléfono por usuario y negocio.** Una nueva vinculación reemplaza la anterior.
- **Desvincular.**
  - El dueño o administrador desvincula cualquiera; cada persona, el suyo.
  - Desvincular cierra la confirmación abierta de ese vínculo.

## 4. Membresía, revalidada en cada mensaje

Un vínculo solo habla por su usuario si, **en ese momento**, se cumple todo esto:

- el usuario es miembro activo del negocio, con rol owner, admin o staff (un rider no);
- no está deshabilitado (`identity_user_security.disabled_at`) ni bloqueado o borrado en Auth;
- el negocio está activo;
- no le cerraron las sesiones después de vincular: "cerrar todas las sesiones" también corta
  WhatsApp.

Se vuelve a revisar al confirmar. Un miembro dado de baja entre el `facturar` y el `SI` no factura.

## 5. Confirmaciones persistentes

`whatsapp_pending_actions` guarda cada confirmación en la base:

- está atada a UN pedido, su total y su acción;
- vence en 5 minutos;
- hay una sola abierta por teléfono (índice único), así que un `SI` nunca es ambiguo;
- sobrevive a un reinicio de la función.

Casos:

| Caso | Resultado |
|---|---|
| `SI` vencido | "La confirmación venció", no factura |
| `SI` para otro pedido | no confirma el abierto |
| Segundo `SI` | "No hay nada para confirmar" |
| El total del pedido cambió | se rechaza y hay que pedir de nuevo |
| Un nuevo `facturar` | reemplaza la confirmación anterior |

La clave de idempotencia de la factura es la de la confirmación (`wa-<id>`): un reintento converge.

## 6. Reintentos de Meta y dedup

- `whatsapp_inbound_messages.wa_message_id` es la clave primaria. La primera entrega inserta y
  procesa en la misma transacción; las demás no hacen nada (probado con 2, 10 y 100 entregas
  simultáneas).
- Si un mensaje no llegó a la base, la función responde 500 y Meta reintenta el lote. Lo ya
  procesado es un duplicado.
- Una respuesta que no salió (Graph API caída) queda `pending` y se reintenta en las llamadas
  siguientes, hasta 5 veces y dentro de las 24 h. No provoca un reintento de Meta.

## 7. Privacidad y registros

- El texto libre de los mensajes **no se guarda**: solo el comando y su resultado.
- El Panel muestra los números enmascarados (`+54 ••• 0101`).
- Los logs de la función no llevan texto, números completos, tokens ni secretos.
- Un número sin vínculo recibe cómo vincularse una vez cada 10 minutos; lo que no sea texto no
  se le contesta.

## 8. Configuración (HUMAN_ACTION_REQUIRED)

La hace una persona con acceso a Meta y a Supabase. El código no inventa ninguno de estos valores.

Secretos de la función `whatsapp-webhook`:

| Variable | Qué es |
|---|---|
| `WHATSAPP_APP_SECRET` | App Secret de la app de Meta. Firma los webhooks |
| `WHATSAPP_VERIFY_TOKEN` | token que se elige y se carga igual en la configuración del webhook en Meta |
| `WHATSAPP_ACCESS_TOKEN` | token permanente (usuario del sistema) con permiso para enviar mensajes |
| `WHATSAPP_PHONE_NUMBER_ID` | id numérico del número de WhatsApp Business que contesta |
| `WHATSAPP_GRAPH_API_VERSION` | versión de la Graph API a usar (`vNN.N`), según la app de Meta |

Pasos:

- Desplegar con `supabase functions deploy whatsapp-webhook`. `config.toml` ya fija
  `verify_jwt = false`.
- En la app de Meta, configurar el webhook con
  `https://<proyecto>.supabase.co/functions/v1/whatsapp-webhook` y el verify token, y suscribir
  el campo `messages`.
- Sin cualquiera de los secretos, la función no arranca: falla cerrada.

## 9. Pruebas y evidencia

| Suite | Qué fija | Resultado |
|---|---|---|
| `supabase/tests/whatsapp_fiscal_channel_test.sql` (pgTAP, 68) | vincular (hash, intentos, vencimiento, bloqueo); comandos con datos reales; confirmaciones (vencida, cruzada, reemplazada, cancelada, SI duplicado); revalidación (baja, sesiones cerradas, revocación); dos negocios; PDF por id de artefacto; permisos; nada de texto libre | PASS (PG17+shim) |
| `scripts/whatsapp/whatsapp-channel-race.mjs` | dedup con 2, 10 y 100 entregas simultáneas; 10 teléfonos con un código; 20 secretos malos a la vez; caos Panel + Mobile + Automation + SI ×5 + otro SI | PASS: 1 fila y 1 respuesta; 1 vínculo; 5 contados; 1 comprobante |
| `scripts/run-release-v5-db.mjs` (CI) | la suite y las carreras en la cadena canónica | 757 aserciones PASS local (PG17+shim) |
| `whatsapp-webhook-gateway.deno.ts` (Deno, 10, CI `test:webhook`) | firma (vector HMAC, alterado, otro secreto, sin secreto), verificación GET, lotes y orden, estados ignorados, botones, duplicados, otro número, 500 para reintento, envío fallido pendiente, límites, envío por la Graph API | PASS |
| `npm run whatsapp:verify` (local) | gateway real + firmas + esquema real + worker canónico + FakeArca + PDF real: vincular, lote en orden, reentrega ×5, reinicio, PDF por la ruta del artefacto, SI vencido, baja, revocación | PASS |
| `tests/whatsapp-fiscal-texts.test.mjs` | WhatsApp y el Panel dicen lo mismo (razones y estados) | PASS |
| `tests/whatsapp-panel-linking.test.mjs` | el Panel pide el código, lista y desvincula con las RPC reales | PASS |

## 10. Lo que falta

- **REAL_META**: número de WhatsApp Business, app de Meta, App Secret, token y la versión de la
  Graph API. Es HUMAN_ACTION_REQUIRED, y después hay que probar contra WhatsApp real.
- **Avisar** cuando ARCA autoriza: hoy se consulta con `estado`. Las respuestas proactivas fuera de
  la ventana de 24 h de Meta necesitan plantillas aprobadas, que decide una persona.
- La facturación real (producción) sigue bloqueada por las compuertas fiscales de La Taba.
