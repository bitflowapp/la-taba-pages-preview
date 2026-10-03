# EVIDENCE-MAP — de dónde salió cada plano del video

Este documento existe para que cualquiera pueda verificar el video plano por plano.
La regla que se siguió es una sola:

> **Nada de lo que se ve fue inventado, dibujado ni maquetado.** Cada pantalla es
> la interfaz real de TABA2 corriendo, o una captura ya tomada y certificada por
> una sesión anterior. Cuando algo es de prueba, sintético o de homologación,
> el video lo dice en pantalla mientras se lo muestra.

---

## 1. Qué se filmó y cómo

El video **no** es un montaje de capturas sueltas sobre una plantilla. Se armó un
compositor de 1920×1080 (`_work/overlay/compositor.html`) que contiene un `<iframe>`
con la aplicación real. Playwright maneja la aplicación **dentro** del iframe y, en
la misma pasada, anima el texto por encima. Lo que se graba es esa página compuesta.

Consecuencia práctica: **el texto de la izquierda y la interfaz de la derecha son el
mismo fotograma.** No hay forma de que la narración muestre una pantalla y afirme otra.

| Parámetro | Valor |
| --- | --- |
| Resolución de captura | 3840×2160 (deviceScaleFactor 2), codificada a 1920×1080 |
| Motor | Chromium de Playwright, `serviceWorkers: block`, locale `es-AR` |
| Servidor | estático local, `127.0.0.1:8481` y `127.0.0.1:8482` (`_work/serve.mjs`) |
| Reproducible con | `node _work/s1.mjs`, `s2.mjs`, … (un archivo por escena) |

---

## 2. Fuentes de código

| Origen | Worktree | Rama | HEAD |
| --- | --- | --- | --- |
| Tienda, Panel, seguimiento, centro de operación | `D:\1212\la-taba2-first-physical-e2e` | `release/taba2-first-physical-e2e` | `3d69e6b` |
| Facturación automática (escena 6) | `D:\1212\la-taba2-arca-fiscal-automation` | `feature/taba2-arca-fiscal-automation` | `af93aeb` |
| Canal de pedidos por WhatsApp (escena 7, textos) | `D:\1212\la-taba2-whatsapp-commerce` | `feature/taba2-whatsapp-commerce` | `c1e7cb6` |

Ninguna rama se modificó. Esta sesión no hizo un solo commit en el repositorio.

---

## 3. Plano por plano

### Apertura
Placa tipográfica. Sin afirmaciones de producto.

### Escena 1 — El cliente (en vivo)

| Qué se ve | Origen | Rótulo en pantalla |
| --- | --- | --- |
| Home de La Taba 2, catálogo, combos | app real en modo demostración (`?demo=1`), puerto 8481 | «Modo demostración» + «Interfaz real de TABA2 · catálogo y datos de demostración» |
| Ficha del combo Heineken x6 con ahorro | la misma app; el ahorro (`$ 23.400 → $ 21.000`) lo calcula el producto | idem |
| Carrito, dirección guardada, forma de pago, +18 | idem | idem |
| Pedido confirmado **LT-0002 · 2 productos · $ 9.466** | el total lo calculó la app: 3.900 + 3.576 + 1.990 de envío | idem |

**Qué es demo y qué no:** el catálogo, los precios y el cliente («Cliente Demo») son
fixtures del modo showcase. El **motor** —carrito, mínimo de delivery, envío, control
+18, numeración del pedido, máquina de estados— es el mismo código que corre en el
entorno desplegado.

**Por qué el pago no aparece acá:** en modo demostración no hay pasarela. Se dice en
la escena siguiente, con la evidencia real.

### Escena 1B — La prueba (capturas reales)

| Qué se ve | Archivo de origen |
| --- | --- |
| Checkout de Mercado Pago | `artifacts/taba2-first-physical-e2e/e2e-final/p03-mercadopago.png` |
| «PAGO CON MERCADO PAGO · Pedido confirmado · Pedido **LT-0096**» | `artifacts/taba2-first-physical-e2e/evidencia/11-pedido-confirmado.png` |
| Bandeja del Panel con el pedido entrado | `artifacts/taba2-first-physical-e2e/negocio/n02-bandeja.png` |

Capturas de la certificación `TABA2_FIRST_PHYSICAL_E2E` (lock
`_claude-locks/taba2-staging-mutation.lock`, `STATUS=CERRADO_CERTIFICADO`), tomadas
contra el **entorno de pruebas**, con Mercado Pago en **modo TEST**. Sin dinero real.
Único tratamiento aplicado: recorte y escala al encuadre del marco (`_work/prep-stills.sh`).
Ni un pixel del contenido se retocó.

Rótulo en pantalla: chip «Mercado Pago · modo prueba» + «Compra real contra el entorno
de pruebas · sin dinero real».

### Escena 2 — El negocio (en vivo)

El mismo pedido **LT-0002** entrando al Panel. Se ve la tarjeta con cliente, teléfono,
dirección, referencia, forma de pago, total a cobrar y detalle de productos, y se lo
hace avanzar con los botones reales: **Nuevo → Preparando → Listo**.

El botón de avance desaparece en «Listo» porque el paso siguiente es del repartidor:
eso no es una decisión del video, es cómo funciona el producto.

### Escena 3 — El reparto (capturas del teléfono real)

**Acá no hay demo.** Son capturas del **Moto G15 (Android 15)**, tomadas el
**2026-08-08** en **una sola corrida** sobre el build `commercialReview`
(`com.lataba.rider.review`). Ese build se instala **al lado** de staging, no lleva
ninguna configuración de backend y se alimenta de `lib/review/review_fixtures.dart`:
no puede leer ni modificar un pedido real. El pedido que se ve, `LT-1042`, y el
domicilio `Los Álamos 1450, Confluencia` son **fixtures**, no un cliente.

Se reproduce con `_work/capturar-rider.ps1`. El único proceso sobre la imagen es
recortar la barra de navegación y bajar de escala al encuadre del marco.

| Plano | Escenario del build de revisión |
| --- | --- |
| Buscando pedidos | 2 · Buscando pedidos |
| Nuevo pedido · Aceptar | 3 · Pedido disponible |
| Yendo a retirar | 5 · Yendo a La Taba 2 |
| Retirado | 6 · Retirado en La Taba 2 |
| En la calle, con el mapa del pedido | 7 · Yendo al cliente |
| Llegaste | 8 · Llegaste y código |
| Código de entrega cargado | 8 · Llegaste y código, con el código escrito |
| Entrega completada | 9 · Entrega completada |
| Sin conexión (la app encola) | 10 · Sin conexión |

**Por qué se recapturó todo.** Hasta el 2026-08-08 estos nueve planos venían de dos
corridas distintas y las dos habían quedado obsoletas:

- las de `taba2-rider-map-redesign` (04/08) mostraban el comercio **«Tercera Docena —
  Diag. España 115»**, que ya no existe en el repositorio, con el pin del negocio
  junto a **Parque Central**;
- las de `taba2-rider-commercial-redesign` (05/08) sí decían «La Taba 2 — Mendoza
  827», pero mostraban **«Mapa no disponible para este pedido: no hay coordenadas
  autorizadas»**. Eso era cierto entonces y dejó de serlo cuando la app adoptó el
  contrato central de ubicación.

Ahora los nueve salen del mismo build y del mismo pedido, así que la escena es
internamente coherente. Las capturas anteriores se conservan en
`_work/overlay/stills/_reemplazadas-20260808/`.

**Lo que la app dice y no oculta:** el destino del cliente en los fixtures **no lleva
coordenada** —lo impone `review_isolation_test`—, así que la app avisa en pantalla
«No pudimos ubicar el destino en el mapa. Usá la dirección escrita». Eso es el
producto funcionando, no una falla de la captura: cuando falta un dato, se dice.

**Lo que NO se muestra, a propósito:** ningún fix de GPS. Estas capturas no llevan
posición del repartidor, y la narración ya no la afirma. El punto azul de la versión
anterior era la ubicación real de quien sostenía el teléfono ese día.

Rótulo en pantalla: chips «App Android real» + «Datos de prueba», y pie
«Capturas del dispositivo real · Moto G15 · Android 15 · pedido de prueba».

### Escena 4 — El seguimiento (en vivo)

El mismo pedido, ahora visto desde el teléfono del cliente. El mapa es **MapLibre
sobre OpenFreeMap**, montado de verdad (`data-map-status="ready"`); la ruta y la
posición del repartidor las produce el recorrido de muestra del modo demostración,
y **la propia interfaz lo rotula**: «Recorrido de muestra · ahora».

**Refilmada el 2026-08-08.** La toma anterior salía del punto equivocado: el escenario
del mapa en modo demo tenía su propia copia a mano de `-38.95172, -68.05942`, sobre
Avenida Argentina junto a Parque Central, a **793 m** de la puerta. Ahora los dos
extremos del recorrido salen del contrato central `data/business-location.json`:

- **origen:** La Taba 2, Mendoza 827 (`-38.9460616, -68.0533209`);
- **destino:** un espacio público declarado —Plaza de la Vida—, **nunca** el domicilio
  de una persona;
- **el trazo entre los dos** no está dibujado a ojo: es el recorrido real por calles
  que devuelve OSRM sobre OpenStreetMap, 1441 m, simplificado a 12 vértices.

El domicilio que el cliente carga en el checkout de esta escena también se cambió:
antes decía «Avenida Argentina 450», que además de ser un domicilio verosímil caía
junto a Parque Central. Ahora es un punto rotulado como destino de demostración.

La frase de cierre de la escena —«si el repartidor deja de reportar, el sistema lo
dice; nunca inventa una posición»— corresponde a un comportamiento real y certificado
del producto (estados `Ubicación temporalmente no disponible` / `Mapa no disponible
para este pedido`, visibles en la evidencia del reparto físico).

### Escena 5A — Qué está pasando en el negocio (Panel de producción con fixtures)

Es el **Centro de operación** real del Panel. Los datos entran por intercepción de
red con fixtures locales, portados de `scripts/business-panel-screenshots.mjs` del
propio repositorio (`_work/fixtures.mjs`). **No se consultó ningún backend.**

Lo que se ve —3 pedidos nuevos, 1 demorado, 2 pagos en camino, 1 a revisar, 2
preparaciones abiertas, 2 envíos en la calle, 1 comprobante pendiente, 1 impresión con
problema, 1 para conciliar— son cifras de prueba. **La pantalla, los textos, los
umbrales y el orden de prioridad son del producto.**

También se muestra «Abrir el negocio»: la revisión de internet, cobros, facturación,
repartidores y colas antes de empezar a vender.

Rótulo en pantalla: chip «Datos de prueba» + «Panel del negocio · datos de prueba,
ningún dato real de clientes».

### Escena 5B — Ventas, ticket y stock (en vivo, jornada de demostración)

Se crearon **seis pedidos** con la misma función de checkout del producto y se
cerraron cuatro como entregados. Las métricas que se ven **las calculó la aplicación**
a partir de esos pedidos:

- Pedidos creados: 6
- Ticket promedio: $ 8.805
- Ventas del turno: $ 52.832
- Más vendidos del turno: Red Bull 2 · Heineken 2 · Corona 2

Después se muestra el **Catálogo editable** con el stock por producto.

### Escena 6 — La facturación (sintético / homologación)

**Rótulo permanente en la parte superior durante toda la escena:**
«DEMOSTRACIÓN SINTÉTICA · HOMOLOGACIÓN — NO ES PRODUCCIÓN».

| Qué se ve | Origen |
| --- | --- |
| Pantalla «Configuración fiscal · Se configura una vez…», los seis pasos, el tablero del día y la bandeja de excepciones | UI real del worktree ARCA (`af93aeb`), con fixtures locales |
| Comprobante en PDF con CAE, QR y detalle | generado por la herramienta del propio producto: `npm run fiscal:sample` |

**El comprobante.** Lo produjo el mismo generador que usa el sistema, en ambiente
`synthetic`. El archivo se rotula solo:

```
COMPROBANTE SINTÉTICO — DATOS DE PRUEBA — NO EMITIDO POR ARCA — SIN VALIDEZ FISCAL
CAE: 99999999999999
Ambiente: SYNTHETIC
Documento sintético generado para revisar el formato. No corresponde a ninguna operación.
```

- sha256 `70b03b36b556c91e6ad34682bf79022b9020ad267700283ee2d661f4d17db626`
- generador `taba-fiscal-pdf-2026.08.07.1`
- copia del PDF: `_work/comprobante-muestra.pdf`

**Lo que el video dice y hay que sostener:** el circuito fiscal está construido y
probado de punta a punta con fixtures; para facturar de verdad falta el **certificado
X.509 de ARCA**, que exige una persona con Clave Fiscal frente a WSASS. Producción
sigue bloqueada a propósito. Eso está declarado en `ARCA-FISCAL-HANDOFF.md` §1 y §10
del worktree, y el video lo repite en pantalla en vez de taparlo.

**Qué NO se tocó:** ni credenciales, ni `fiscal_documents`, ni `fiscal_outbox`, ni
ningún ambiente de ARCA. No se emitió ningún comprobante en ningún ambiente.

### Escena 7 — WhatsApp (diagrama rotulado, no captura)

**No se muestra ninguna captura de WhatsApp, porque no existe:** el canal está
construido y certificado en pruebas, pero todavía no está conectado a un número
oficial de WhatsApp Business.

Lo que se ve es un diagrama con la identidad de TABA2, con un encabezado que dice
literalmente «flujo certificado en pruebas… **No es una captura de WhatsApp**», y
cuyos textos e importes salen de la certificación:

| Dato en pantalla | Fuente |
| --- | --- |
| Fernet Branca · Botella 750 ml · $ 12.800 | `supabase/tests/fixtures/whatsapp_commerce_seed.local.sql` |
| Coca-Cola Original · Botella 1,5 L · $ 3.200 | idem |
| subtotal 20.000 − descuento 1.700 + envío 1.500 = **19.800** | `WHATSAPP-COMMERCE-HANDOFF.md` §6 |
| «Mercado Pago confirmó tu pago ✅ Tu pedido es LT-0101 por $ 19.800.» | `WHATSAPP-COMMERCE-HANDOFF.md` §3 |

Declaración de la rama: `TABA2_WHATSAPP_COMMERCE_TEST_FLOW_CERTIFIED`.
Simulados y declarados en esa certificación: la Graph API de Meta y la API HTTP de
Mercado Pago. El resto del circuito corrió contra una base real y efímera.

### Cierre
Placas tipográficas. Ninguna afirmación técnica.

---

## 4. Lo que el video NO afirma

Para que quede por escrito, y para que nadie tenga que deducirlo:

1. **No dice que TABA2 esté vendiendo en producción hoy.** Dice qué hace y qué está probado.
2. **No dice que se esté facturando.** Dice que el circuito está hecho y qué falta para facturar.
3. **No dice que WhatsApp esté operativo.** Dice que está construido y probado, y que falta el número oficial.
4. **No muestra ningún dato de un cliente real.** Todos los nombres, direcciones y teléfonos son de prueba.
5. **No presenta ningún dinero real.** El único pago que se ve es de Mercado Pago en modo TEST.

---

## 5. Aislamiento de esta sesión

Declarado en `D:\1212\_claude-locks\taba2-walter-commercial-demo.txt`:

- `STAGING_MUTATED=false`
- `PRODUCTION_TOUCHED=false`
- `ARCA_TOUCHED=false`
- `SUPABASE_TOCADO=false` — todo corrió contra el servidor estático local
- `MOTO_G15_TOCADO=false` — el teléfono quedó como estaba
- Pedidos reales tocados: ninguno
- Commits en el repositorio: ninguno
