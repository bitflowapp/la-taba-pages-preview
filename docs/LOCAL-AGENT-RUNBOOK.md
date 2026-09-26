# Taba.LocalAgent · runbook de operación (v0.1.0)

El agente local imprime en la PC del mostrador lo que el backend de La Taba
decide: comanda de cocina, ticket de pedido y, cuando ARCA autorice, el
comprobante fiscal. **No es un segundo backend**: no guarda pedidos, stock,
precios ni usuarios, y si se apaga el local sigue operando desde el Panel web.

```
Panel web ─► backend (print_jobs) ─► print-agent-gateway ─► Taba.LocalAgent ─► spooler de Windows ─► impresora
```

Decisión de arquitectura: [`PANEL-ARCHITECTURE-DECISION.md`](PANEL-ARCHITECTURE-DECISION.md).
Código: [`agents/windows-local-agent`](../agents/windows-local-agent/README.md).

---

## 0 · Antes de la primera instalación (una vez por proyecto)

1. Migración `supabase/migrations/20260926160000_local_print_agent.sql`
   aplicada en el destino (tablas `local_devices`, `print_jobs`,
   `print_job_events`, `business_print_settings`, RPC y triggers).
   Rollback probado: `docs/migrations/rollback/20260926160000_local_print_agent.rollback.sql`.
2. Edge Function `print-agent-gateway` desplegada con `verify_jwt = false`
   (está en `supabase/config.toml`): es la única puerta del agente.
3. `appsettings.json` del instalador apunta a
   `https://<ref>.supabase.co/functions/v1/print-agent-gateway` con la clave
   **publicable** del proyecto (es pública; la misma que usa la web).

Nada de esto requiere secretos en la PC del local.

### Estado en CONTROLLED_PRODUCTION (2026-09-26)

| Qué | Valor real |
|---|---|
| Proyecto | Supabase `tkanbadcglszlcyfjvpv` (CONTROLLED_PRODUCTION) |
| Migración | `20260926160000_local_print_agent` aplicada el 2026-09-26 21:40 UTC con `supabase db push --linked` (140 migraciones, local = remoto). Backup previo verificado: `~/.taba-backups/controlled-production/pgdump-2026-09-26T21-36-28-498Z` |
| Gateway | `https://tkanbadcglszlcyfjvpv.supabase.co/functions/v1/print-agent-gateway` — v1, `ACTIVE`, `verify_jwt = false`; usa sólo los secretos por defecto de la plataforma |
| `appsettings.json` del MSI | ya apunta a esa gateway con la clave publicable de CP (la misma de la web) |
| Certificación | `verify-cp-printing.mjs` 65/65 y el binario real 14/14 (ver 16) |
| Impresión en papel | **PENDING_DEVICE** (sección 14) |

## 1 · Instalar

Requisitos de la PC: Windows 10/11 x64, impresora instalada en Windows (USB o
red) **como impresora local**, no conectada «por usuario».

1. Descargar `TabaLocalAgent-0.1.0-win-x64.msi` y su `SHA256SUMS.txt`.
2. Verificar el hash:
   `Get-FileHash .\TabaLocalAgent-0.1.0-win-x64.msi -Algorithm SHA256`
   y compararlo con `SHA256SUMS.txt`. **Si no coincide, no instalar.**
3. Instalar (pide administrador una sola vez):
   `msiexec /i TabaLocalAgent-0.1.0-win-x64.msi`
   o silencioso: `msiexec /i TabaLocalAgent-0.1.0-win-x64.msi /qn /l*v install.log`.

Queda instalado:

| Qué | Dónde |
|---|---|
| Ejecutable (autocontenido, no requiere .NET) | `%ProgramFiles%\La Taba\LocalAgent\TabaLocalAgent.exe` |
| Configuración común (sin secretos) | `%ProgramFiles%\La Taba\LocalAgent\appsettings.json` |
| Servicio | `TabaLocalAgent`, cuenta `LOCAL SERVICE` (nunca administrador), inicio automático, se reinicia solo ante fallas |
| Datos: credencial DPAPI, diario, logs, impresoras | `%ProgramData%\TabaLocalAgent` (sólo SYSTEM, Administradores y el servicio) |
| API local | `http://127.0.0.1:17872` (nunca en la red del local) |

## 2 · Registrar el dispositivo

1. Se emite un código de un solo uso (vence en 15 minutos; hasta 3 vigentes
   y 5 agentes activos por negocio):
   ```
   node scripts/print-agent/dispositivos.mjs codigo --target=controlled-production \
     --business=<uuid> --confirmar=<slug> --nombre="Mostrador"
   ```
   o el dueño/admin con la RPC `create_local_device_pairing(business_id, nombre)`
   (la usa la certificación; la pantalla del Panel todavía no existe). Staff,
   rider, otro negocio y anónimo reciben `42501`.
2. En la PC del local, consola **de administrador**:
   ```
   "%ProgramFiles%\La Taba\LocalAgent\TabaLocalAgent.exe" register --code XXXXX-XXXXX --name "Mostrador"
   ```
   El agente genera su propio secreto, manda al backend sólo su SHA-256 y lo
   guarda protegido con DPAPI. El código queda consumido.
3. `TabaLocalAgent status` debe mostrar `"registration": "ACTIVE"` en menos de
   un minuto.

Un código vencido o ya usado devuelve `DEVICE_UNAUTHORIZED`: pedir otro.
Máximo 5 agentes activos por negocio.

## 3 · Elegir impresoras

```
TabaLocalAgent printers
TabaLocalAgent configure --document kitchen_ticket --printer "POS-80 Cocina" --width 80 --codepage pc850
TabaLocalAgent configure --document order_ticket   --printer "POS-58 Caja"   --width 58
TabaLocalAgent configure --document fiscal_receipt --printer "POS-58 Caja"   --width 58
```

| Opción | Valores | Nota |
|---|---|---|
| `--driver` | `escpos` (defecto), `windows` | `escpos` manda bytes RAW: corte y QR nativos. `windows` dibuja con el driver (láser, chorro de tinta o térmicas sin modo RAW). |
| `--width` | `58`, `80` | 32 / 48 columnas. |
| `--codepage` | `ascii` (defecto), `pc850`, `pc858`, `wpc1252` | `ascii` translitera («Neuquén» → «Neuquen») y funciona en todas. Pasar a `pc850` sólo después de ver los acentos bien en la hoja de prueba. |
| `--copies` | `1`–`3` | Si falla una copia después de la primera, el resultado es «desconocido». |

El servicio toma el cambio sin reiniciar. Un documento sin impresora
configurada no se reclama.

## 4 · Hoja de prueba y muestras

```
TabaLocalAgent test-print --printer "POS-80 Cocina" --width 80 --codepage pc850
TabaLocalAgent test-print --printer "POS-80 Cocina" --width 80 --sample kitchen
TabaLocalAgent test-print --printer "POS-58 Caja"   --width 58 --sample order
TabaLocalAgent test-print --printer "POS-58 Caja"   --width 58 --sample fiscal
```

La muestra fiscal es de homologación con CAE en ceros y dice «COMPROBANTE DE
PRUEBA · SIN VALIDEZ FISCAL» arriba y abajo. La prueba no crea trabajos en el
backend.

Si la hoja sale con `PRINTER_RAW_UNSUPPORTED`, el driver no acepta RAW
(drivers v4/XPS): usar `--driver windows` o instalar el driver ESC/POS del
fabricante / «Generic / Text Only».

## 5 · Salud

`TabaLocalAgent status` (o `GET http://127.0.0.1:17872/v1/health`):

| Campo | Significado |
|---|---|
| `version` | SemVer del agente. |
| `registration` | `NOT_REGISTERED`, `ACTIVE`, `REVOKED`. |
| `backend` | `CONNECTED`, `UNREACHABLE`, `UNKNOWN`, con `last_backend_contact`. |
| `printers` | Por documento configurado: `READY`, `OFFLINE`, `ERROR`, `UNKNOWN`. |
| `queue_depth` | Trabajos en curso o con resultado por informar en esta PC. |
| `needs_attention` | Resultados dudosos de las últimas 24 h. |

No expone secretos, rutas ni ids de dispositivo. El Panel ve el mismo estado
por el latido (`get_local_print_status`): `ONLINE` si latió en los últimos 150 s.

Operación: `node scripts/print-agent/dispositivos.mjs estado --target=... --business=<uuid>`.

## 6 · Qué pasa cuando algo falla (y por qué no hay tickets dobles)

El orden es siempre: reclamar → registrar `printing` en el backend →
**recién entonces** mandar bytes → informar. Sin la confirmación de `printing`
no se imprime.

| Situación | Qué hace el agente | Qué ve el Panel |
|---|---|---|
| Impresora apagada antes de enviar | No envía nada; informa `not_printed` | El trabajo vuelve a la cola con espera (10 s, 20 s… hasta 5 min); tras 5 intentos, `failed`. |
| Impresora se apaga durante el trabajo | El spooler lo marca en error: el agente lo **cancela** en Windows (para que no salga horas después) e informa `unknown` | `needs_review`. |
| Corte de luz / reinicio de Windows durante la entrega | Al arrancar, lo que estaba «entregándose» pasa a `unknown` | `needs_review`. |
| Reinicio antes de tocar el spooler | Informa `not_printed` | Vuelve a la cola. |
| Sin internet | No reclama ni imprime; lo pendiente queda en el diario y se informa al volver | `OFFLINE`; los pedidos siguen en el Panel. |
| Backend caído | Espera 5, 10, 20… hasta 120 s entre intentos | — |
| Reclamo vencido (el agente tardó más de 60 s) | No imprime | El trabajo vuelve a la cola para otro agente. |

**`needs_review` nunca se reimprime solo.** Una persona decide en el Panel (o
con operación): «salió» (`resolve_print_job_review … 'printed'`) o «no salió»
(`… 'not_printed'`) y, si hace falta, reimprime.

## 7 · Reimprimir

Reimprimir es siempre una acción explícita que crea **otro** trabajo con
`reprint_of`, quién la pidió, cuándo y por qué; el papel dice
«*** REIMPRESIÓN ***» (o «DUPLICADO» en el comprobante fiscal).

- Panel / operación: RPC `request_print_job_reprint(job_id, motivo, clave)`.
- Desde el mostrador (API local con token):
  `POST /v1/reprint {"job_id": "...", "reason": "papel trabado", "operator_label": "Caja 1", "idempotency_key": "..."}`.

Un doble clic con la misma clave no reimprime dos veces. No se reimprime lo
que todavía está en curso.

## 8 · Reiniciar

```
Restart-Service TabaLocalAgent        # consola de administrador
```

Seguro en cualquier momento: el diario resuelve lo que quedó a medias sin
imprimir de nuevo (ver 6).

## 9 · Logs

`%ProgramData%\TabaLocalAgent\logs\agent-AAAAMMDD.jsonl`, un JSON por renglón,
14 días. Campos: `ts`, `level`, `event_id`, `action`, `job`, `device`,
`printer`, `duration_ms`, `error`. Pasan por un saneador: nunca llevan la
credencial, hashes, códigos de emparejamiento ni datos del cliente. También
van al Visor de eventos (origen `TabaLocalAgent`).

## 10 · Rotar la credencial

```
TabaLocalAgent rotate
```

Rotación en dos fases: el secreto nuevo queda pendiente y el primer latido
que lo usa lo activa; si esa respuesta se pierde, el anterior sigue valiendo.

## 11 · Revocar (PC perdida, robada o reemplazada)

```
node scripts/print-agent/dispositivos.mjs revocar --target=controlled-production --device=<uuid> --motivo="PC robada"
```

(o `revoke_local_device` desde el Panel, dueño/admin). Efecto inmediato: la
credencial deja de valer, lo reclamado sin empezar vuelve a la cola y lo que
se estaba imprimiendo queda en `needs_review`. En la PC: `TabaLocalAgent unregister`.

## 12 · Actualizar

v0.1 **no se actualiza sola** (no hay auto-update sin firma verificada).

1. Descargar el MSI nuevo y verificar su SHA-256 (y su firma Authenticode
   cuando exista el certificado de firma: `Get-AuthenticodeSignature`).
2. `msiexec /i TabaLocalAgent-<versión>-win-x64.msi`: el MSI reemplaza la
   versión anterior (MajorUpgrade), conserva la credencial, el diario y la
   configuración de impresoras.
3. `TabaLocalAgent status` debe mostrar la versión nueva.

Volver a una versión anterior: desinstalar e instalar el MSI anterior (el MSI
rechaza un downgrade directo).

## 13 · Desinstalar

```
msiexec /x TabaLocalAgent-0.1.0-win-x64.msi      (o «Agregar o quitar programas»)
```

Se quitan el servicio y los binarios. `%ProgramData%\TabaLocalAgent` se
conserva para una reinstalación; para borrar todo: revocar el dispositivo (11)
y luego borrar esa carpeta como administrador.

## 14 · Certificación física (pendiente de impresora)

Con la térmica del local conectada:

| # | Prueba | Esperado |
|---|---|---|
| 1 | `test-print` 58 y/o 80 mm | Regla completa de 32/48 columnas, corte. |
| 2 | Acentos con `--codepage pc850` | «áéíóú ñ ¿ ¡» legibles; si no, volver a `ascii`. |
| 3 | QR (`--sample fiscal`) | El QR se lee con el teléfono. |
| 4 | Dos pedidos seguidos (comanda automática) | Dos comandas, cada una una sola vez. |
| 5 | Impresora apagada, aceptar un pedido, encenderla | No sale nada mientras está apagada; al volver sale una sola vez. |
| 6 | Desenchufar durante la impresión | `needs_review`; no sale un ticket «sorpresa» después. |
| 7 | Reimprimir desde el Panel/API | Sale con «REIMPRESIÓN»; queda auditado. |
| 8 | Reiniciar Windows con trabajos en cola | Nada se imprime dos veces. |

Hasta completar esta tabla: **PHYSICAL_PRINTER_GATE: PENDING_DEVICE**.

## 15 · Certificación en CONTROLLED_PRODUCTION

Se repite después de cualquier cambio en la migración, la gateway o el agente.
Usa sólo sesiones QA reales (dueño, staff, dueño del negocio de aislamiento,
rider), un cliente anónimo para el pedido QA y la gateway tal como la llama el
agente. Sin clave secreta ni SQL; todo queda en los tenants QA y la limpieza
revoca los dispositivos, restaura la configuración y cierra la ventana QA.

```
node scripts/controlled-production/verify-cp-printing.mjs --target controlled-production --out <archivo fuera del repo>
```

| Frente (2026-09-26, 65/65) | Qué se prueba |
|---|---|
| Gateway | `Origin` → 403, `GET` → 405, sin credencial / falsa / código inexistente → 401 |
| Dispositivos | código sólo dueño/admin, de un uso; alta de 2 agentes del negocio A y 1 del B; latido visible en el Panel; rotación en dos fases (el secreto viejo muere al usar el nuevo) |
| Trabajos | `order_ticket` y `kitchen_ticket` por la RPC del Panel, idempotentes; rider/ajeno/anónimo `42501`; fiscal desde el Panel rechazado; payload sin datos del cliente y comanda sin precios |
| Estados | `queued → claimed → printing → printed` con auditoría completa; token o dispositivo equivocado → 409; dispositivo de otro negocio → 404 |
| Recuperación | `unknown` → `needs_review` → resolución humana; confirmación tardía aceptada; caída imprimiendo → `needs_review` sin reimprimir; red perdida antes de imprimir → vuelve a la cola una vez; reclamo viejo → 409 |
| Reintentos | `not_printed` respeta la espera (10/20/40/80 s) y pasa a `failed` al 5.º intento |
| Reimpresión | trabajo nuevo con `reprint_of`, quién y por qué; idempotente; dueño y staff sí, rider y ajeno no; también desde el agente |
| Concurrencia | 12 reclamos simultáneos de 2 agentes sobre 20 trabajos → 20 únicos; `printing` doble → 1 evento; 0 impresiones dobles |
| Automática | comanda al entrar un pedido con la impresión automática encendida; se cancela sola si el pedido se cancela |
| RLS | dueño y staff ven lo suyo; dueño ajeno, rider y cliente 0 filas; anónimo `42501` |
| Revocación | sólo el dueño del negocio; efecto inmediato (401) y lo reclamado vuelve a la cola |

El binario real (v0.1.0) se certificó aparte contra la misma gateway, 14/14:
`register` con el código del Panel, credencial DPAPI, código de un uso, latido
`ONLINE 0.1.0` en el Panel y salud `ACTIVE/CONNECTED` sin ids, `rotate`
promovido en el siguiente latido, revocación vista por el agente (`REVOKED`),
`unregister` y logs sin secretos. Evidencia:
`docs/evidence/controlled-production/verify-cp-printing-20260926.json` y
`print-agent-cp-20260926.json`.

## 16 · Seguridad (resumen)

- Escucha sólo en `127.0.0.1`; `Host` validado contra DNS rebinding; `Origin`
  exacto (sólo el Panel oficial); token por instalación (DPAPI) para todo menos
  la salud; preflight de red local de Chrome contestado.
- Credencial del dispositivo: secreto de 32 bytes generado en la PC, en el
  backend sólo su SHA-256; DPAPI de máquina + carpeta cerrada. Nunca en logs.
- El agente nunca tiene `service_role`: habla con `print-agent-gateway`, que
  verifica la credencial y llama RPC sólo-`service_role`. `anon` no gana
  ninguna función (siguen siendo exactamente 8 SECURITY DEFINER públicas).
- La gateway rechaza todo pedido con `Origin`: una web no puede usar una
  credencial robada desde un navegador.
- Un ticket fiscal sólo existe con CAE de 14 dígitos (lo valida la base al
  insertar, también para `service_role`).
