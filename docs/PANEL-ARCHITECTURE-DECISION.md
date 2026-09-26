# Panel del negocio · decisión de arquitectura (.NET, impresión y ARCA)

Fecha: 2026-09-26. Estado: **decidido (B), sujeto a que el spike demuestre la impresión**.

Pregunta: ¿hay que migrar el Panel del negocio a .NET? Se evaluó con evidencia
del repositorio, de la web publicada en CONTROLLED_PRODUCTION y de la
documentación oficial de ARCA y de los navegadores. No se decide por lenguaje.

---

## CURRENT_STATE

Lo que existe hoy, medido en `release/taba-controlled-production` (`8271035`):

| Pieza | Qué es | Madurez real |
|---|---|---|
| Panel web | JavaScript de módulos nativos, 18 pantallas en `js/production-operations.js` + `js/business/*`, Supabase Auth, bandeja con realtime, outbox de comandos en IndexedDB | En uso en CP. ~60k líneas de JS en la app, 2.645 pruebas unitarias y ~560 E2E (Chromium + WebKit). Auditoría responsive: 0 desbordes, 0 áreas táctiles chicas, 0 contrastes bajos en 144 combinaciones. |
| Backend | Supabase (PostgreSQL, RLS, RPC, Edge Functions) | Fuente de verdad de pedidos, stock, pagos y estado fiscal. Certificado en CP (RLS 58/58). |
| Esquema fiscal | `fiscal_documents`, `fiscal_outbox`, `fiscal_request_attempts`, `fiscal_events`, `fiscal_accounting_policies`, `fiscal_document_artifacts`, `fiscal_print_jobs`, `fiscal_credit_allocations` | Diseñado con idempotencia fuerte (ver FISCAL). **Nunca emitió un comprobante**: la activación falla cerrada (`evaluateArcaActivation`, 9 condiciones). |
| Worker fiscal | `services/arca-fiscal-bridge`, Node/TypeScript: WSAA + WSFEv1 (`FEDummy`, `FECompUltimoAutorizado`, `FECAESolicitar`, `FECompConsultar`), outbox con lease, ambigüedad → consulta antes de reintentar, QR, PDF | Con pruebas (`npm run fiscal:test`, en CI). **No desplegado**. Referencia el manual WSFEv1 4.5; el vigente es 4.7 (ver FISCAL). |
| Shell Windows | `src-tauri`, Tauri 2 en Rust («TABA Negocio»): empaqueta una COPIA del Panel web, SQLite, tray, autoarranque, updater | 2.460 líneas de Rust, 17 pruebas. CI lo compila sin firmar. El workflow firmado nunca corrió, no hay releases ni claves de updater. Imprime **texto crudo** por Winspool (sin comandos ESC/POS: sin corte, sin QR) y PDF con el verbo «print» del shell (resultado «desconocido»). Sólo a pedido del operador: no hay impresión automática. Compilarlo requiere Rust + MSVC, que no están en la notebook del equipo. |
| Web en navegador | El Panel en Chrome/Edge | «Probar dispositivos» dice «Esta prueba necesita TABA para Windows»: sin el shell no hay impresora. |

Dos hechos del navegador que deciden la parte de impresión:

1. `window.print()` **siempre abre el diálogo** y no elige impresora ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/print)). La única impresión silenciosa es el flag `--kiosk-printing` de Chrome, que manda todo a la impresora predeterminada del equipo: no distingue comanda, ticket y A4.
2. Una térmica USB en Windows usa el driver de impresora del sistema: WebUSB no puede tomarla, y además esta web la desactiva a propósito (`_headers`: `Permissions-Policy: usb=()`). Una térmica de red (puerto 9100) no es alcanzable desde una página. Desde Chrome 142, además, cualquier pedido de una web pública a `localhost` exige un permiso explícito del usuario, «Local Network Access» ([Chrome for Developers](https://developer.chrome.com/blog/local-network-access)).

Conclusión del estado actual: **la impresión automática no se puede resolver sin un proceso local**, y el proceso local que existe no la resuelve.

---

## Requisitos que deciden (compuertas)

| Requisito de la misión | A · Web | B · Web + agente .NET | C · Todo en .NET |
|---|---|---|---|
| Operación comercial real (pedidos, caja, stock) | pasa | pasa | pasa, después de reescribir |
| Facturación ARCA | pasa (server-side) | pasa (server-side) | pasa |
| Impresión automática (comanda, ticket, A4) | **no pasa** | pasa | pasa |
| Dueño y equipo desde el teléfono | pasa | pasa | **no pasa** (o duplica el Panel) |
| Riesgo bajo sobre lo certificado en CP | pasa | pasa (aditivo) | **no pasa** (reescritura) |

---

## OPTION_A_WEB — Panel web actual

**PROS**: cero instalación; un solo código; móvil y escritorio iguales; ya certificado; ARCA server-side encaja con el backend; lector de códigos HID ya funciona (es un teclado).

**CONS**: no hay impresión automática ni silenciosa; no hay ESC/POS (corte, QR del comprobante) ni selección de impresora; la cola de impresión no sobrevive a cerrar la pestaña.

**RISK**: bajo técnico, **alto operativo**: el local imprime a mano, con diálogo, en cada pedido.
**EFFORT / MIGRATION_COST**: nulo.
**OPERATIONS**: lo más simple de operar.
**FISCAL**: correcto (worker server-side).
**PRINTING**: insuficiente para cocina/mostrador con volumen.

## OPTION_B_WEB_PLUS_DOTNET_AGENT — Panel web + agente local .NET

El Panel sigue siendo la web de hoy (teléfono, tablet y PC). En la PC del
mostrador corre `Taba.LocalAgent`: un servicio de Windows **sin interfaz de
Panel**, que sólo resuelve lo local.

**PROS**: resuelve impresión automática y silenciosa, ESC/POS (58/80 mm, corte, QR) y PDF A4 con una cola durable e idempotente; no toca el Panel ni el backend certificados; no duplica reglas de negocio; se prueba con `dotnet test` en cualquier máquina del equipo; hosting de servicio, almacén de certificados de Windows, DPAPI y firma CMS (`SignedCms`) son nativos en .NET, por si algún día hace falta custodia fiscal local.

**CONS**: hay que instalarlo, firmarlo y actualizarlo; un canal más para soporte; el pedido directo web → `localhost` requiere el permiso de red local de Chrome 142 (por eso la impresión automática va por el backend, ver PRINTING).

**RISK**: medio-bajo. Es aditivo: si el agente falla, el Panel sigue operando y se imprime a mano.
**EFFORT**: spike 1–2 días (hecho, rama `spike/taba-dotnet-local-agent`); agente de producción 2–4 semanas (instalador, firma, cola en backend, certificación física).
**MIGRATION_COST**: bajo. El shell Tauri se congela (no se borra) y se retira cuando el agente certifique impresión física.
**OPERATIONS**: un servicio por local, con latido visible en el Panel (Agente ONLINE/OFFLINE, Impresora READY/ERROR).

## OPTION_C_FULL_DOTNET — Panel reescrito en .NET

**PROS**: acceso total al hardware; offline nativo.

**CONS**: pierde el Panel en el teléfono (o obliga a mantener dos Paneles); reescritura de 18 pantallas y de sus ~560 pruebas E2E; cada cambio del Panel pasa a ser un release de escritorio firmado; duplica validaciones que hoy viven una sola vez; nada de lo certificado en CP se reutiliza tal cual.

**RISK**: alto. **EFFORT**: meses. **MIGRATION_COST**: el más alto.
**OFFLINE**: no justifica el costo: la política correcta sin red es no confirmar ventas ni emitir comprobantes (ver FISCAL), así que un Panel «offline-first» no agrega capacidad fiscal ni comercial real.

---

## Puntuación ponderada

1 = malo, 5 = muy bueno. Los pesos salen de la misión (robustez, mantenimiento,
impresión, ARCA, móvil y costo pesan más).

| Criterio | Peso | A | B | C |
|---|---:|---:|---:|---:|
| Robustez operativa | 12 | 3 | 4 | 4 |
| Mantenibilidad / duplicación | 12 | 5 | 4 | 2 |
| Tests y verificabilidad | 6 | 5 | 4 | 2 |
| Offline útil | 5 | 3 | 4 | 5 |
| Impresión (automática, térmica, PDF) | 12 | 1 | 5 | 5 |
| ARCA | 10 | 4 | 4 | 4 |
| USB / serie / hardware | 5 | 2 | 5 | 5 |
| Instalación, firma, auto-update | 8 | 5 | 3 | 2 |
| Multi-dispositivo y móvil | 10 | 5 | 5 | 1 |
| Costo de construcción | 10 | 5 | 4 | 1 |
| Riesgo de regresión sobre CP | 10 | 5 | 4 | 1 |
| **Total (sobre 100)** | 100 | **78,6** | **83,8** | **56,0** |

A queda cerca de B en puntos pero **no pasa la compuerta de impresión
automática**; C no pasa ni la de móvil ni la de riesgo.

---

## ¿Por qué un agente .NET y no seguir con el shell Tauri?

La opción B necesita un componente local; ya existe uno en Rust. Se comparó:

| | Shell Tauri actual | Agente .NET |
|---|---|---|
| Qué es | La app de escritorio **entera**: empaqueta una copia del Panel | Servicio sin Panel; el Panel sigue siendo la web |
| Ciclo de release | Cada cambio del Panel exige un instalador nuevo firmado (dos canales para el mismo frontend) | El Panel se publica como hoy; el agente sólo cambia cuando cambia el hardware |
| Impresión | Texto crudo; PDF por verbo del shell; nada automático | ESC/POS con corte y QR; PDF por renderizado propio; cola durable; automática |
| Toolchain del equipo | Rust + MSVC (no instalados en la notebook) | SDK .NET 10 LTS (instalado); `dotnet test` corre acá |
| Servicio de Windows, certificados, CMS | Crates de terceros | Nativo (`Microsoft.Extensions.Hosting.WindowsServices`, `X509Store`, `SignedCms`, DPAPI) |
| Estado | Nunca firmado ni distribuido | Spike con pruebas |

Lo que el shell ya resolvió bien (outbox local, backup, diagnóstico de
soporte) no se pierde: el Panel web tiene su outbox en IndexedDB y el backend
es la fuente de verdad. **FULL_PANEL_DOTNET_MIGRATION_REQUIRED: NO.
DOTNET_LOCAL_AGENT_RECOMMENDED: YES.**

---

## PRINTING

Tres documentos distintos, que no se mezclan:

| Documento | Papel | Cuándo | Contenido |
|---|---|---|---|
| Comanda de cocina / preparación | 58 u 80 mm | Automático al aceptar el pedido | Código `LT-xxxx`, ítems, cantidades, notas. Sin precios. |
| Ticket de pedido / entrega | 58 u 80 mm | Automático al pasar a «listo» o a pedido | Datos de entrega, total, forma de pago. **No es comprobante fiscal**. |
| Comprobante fiscal | A4/PDF o 80 mm | Sólo con CAE autorizado | El PDF/QR que genera el worker fiscal. Antes del CAE sólo se imprime «Comprobante interno no fiscal». |

Flujo recomendado (impresión automática que no depende de una pestaña abierta):

```
Pedido aceptado ─► backend crea print_job (idempotency_key = pedido + tipo + versión)
                        │   (tabla nueva, fase siguiente: requiere cambio de esquema)
                        ▼
   Taba.LocalAgent (identidad de dispositivo, RLS del negocio) lo toma,
   lo renderiza (ESC/POS o PDF), lo manda al spooler y reporta
   QUEUED → PRINTING → PRINTED | FAILED
                        ▲
   Panel web: «Reimprimir» crea OTRO job con reprint_of + actor (auditado)
```

El agente además expone, sólo en `127.0.0.1`, una API chica para que el Panel
liste impresoras y haga la impresión de prueba: `Origin` en lista blanca, token
por instalación, sin CORS abierto. Esa API requiere el permiso de red local de
Chrome 142 una vez; la impresión automática no, porque va por el backend.

Estados e idempotencia de la cola local: un mismo `idempotency_key` nunca se
imprime dos veces; un reinicio durante `PRINTING` queda como «resultado
desconocido» y **no** se reimprime solo (el operador decide). Abstracción de
impresora: `IPrinter` con `EscPosPrinter` (bytes crudos por Winspool),
`PdfPrinter` y `WindowsPrinter`; ningún modelo de impresora queda acoplado.

## FISCAL

Diseño completo, verificado contra el manual WSFEv1 **4.7 (revisión del
2026-09-01)** y la especificación WSAA 1.2.2: [`docs/arca/ARCA-FISCAL-DESIGN-2026-09.md`](arca/ARCA-FISCAL-DESIGN-2026-09.md).

Decisión: **ARCA se opera del lado del servidor**, no en el agente del local.

- Un pedido online se factura aunque la PC del local esté apagada.
- Custodia del certificado en un solo lugar (secret manager), con el comercio
  delegando el servicio `wsfe` a la CUIT del sistema en el Administrador de
  Relaciones; ninguna clave privada viaja a una PC de mostrador.
- El esquema e idempotencia ya existen del lado del servidor.

El agente .NET conserva una frontera fiscal (`IArcaGateway`: WSAA con
`SignedCms`, WSFEv1) sólo para el caso en que un comercio exija custodia local
del certificado (Windows Certificate Store, clave no exportable). Queda
diseñada y probada con dobles, **no habilitada**.

## RECOMMENDATION

**Opción B: Panel web + agente local .NET 10 para impresión y hardware; ARCA
server-side.**

1. No reescribir el Panel. El frontend comercial queda en la web (esta rama).
2. Spike `Taba.LocalAgent` (hecho en `spike/taba-dotnet-local-agent`): salud,
   descubrimiento de impresoras, cola idempotente, ESC/POS, API local con
   `Origin` y token, frontera ARCA con dobles.
3. Siguiente fase, en este orden: tabla `print_jobs` + identidad de dispositivo
   en el backend; instalador firmado (MSI) y actualización firmada; latido del
   agente en el Panel; certificación física con la impresora real del local.
4. Fiscal: actualizar el worker a WSFEv1 4.7 (`CondicionIVAReceptorId`,
   `FEParamGetCondicionIvaReceptor`), decidir dónde corre (función programada o
   contenedor privado) y hacer la homologación con certificado real.
5. El shell Tauri se congela y se retira cuando el agente certifique impresión
   física.
