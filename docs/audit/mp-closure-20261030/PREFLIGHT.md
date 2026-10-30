# Preflight y pasos humanos — sin dinero real

30/10/2026. Usar la rama `audit/mp-activation-closure-20261030` y leer [INFORME.md](INFORME.md). Hasta nueva autorización: no merge, no despliegue, no producción y ningún pago real. Los comandos de lectura no conectan a un vendedor ni lo habilitan para cobrar.

## 1. Reproducir el estado sin crear operaciones

PowerShell, desde la raíz del repositorio. `$ev` debe ser una carpeta nueva fuera del repositorio público; no guardar allí contraseñas, tokens ni códigos OAuth. Los lectores usan las credenciales técnicas propias ya custodiadas en Windows; si no están disponibles, informar el bloqueo sin pedir secretos por chat.

```powershell
$ev = Join-Path $env:LOCALAPPDATA ('LaTaba/evidencia-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $ev | Out-Null
git rev-parse HEAD
git status --short
node scripts/mercadopago/asistente-activacion.mjs estado --json
node scripts/mercadopago/verificar-configuracion.mjs --ref=qa
node scripts/mercadopago/asistente-activacion.mjs red --target qa --json
node scripts/recovery/qa-mp-marketplace.mjs identities --seller 3796774164 --reserve 3796774158
node scripts/recovery/qa-mp-marketplace.mjs preflight --seller 3796774164
node scripts/mercadopago/piloto-pago-real.mjs preflight --target qa --business 7d1f0c52-3b1e-4c8a-9a67-2f5d0e6b1a02
```

Resultados actuales: producción `not_provisioned` (salida 2 esperada), configuración QA `TEST`, red 7 OK y 2 saltos por contraseña del preview; identidades completas; B desconectado; el preflight de piloto de B termina con bloqueos. **Eso no autoriza ninguna compra.** Cada comando debe conservar su código de salida; no usar sólo el éxito del último comando para dar por aprobado el conjunto.

Verificar [CI del código](https://github.com/bitflowapp/la-taba-pages-preview/actions/runs/41008760492) y `evidencia/MANIFEST.sha256`. No repetir las 36 compras del emulador ni las suites de navegador mientras código y dependencias relevantes sigan iguales al SHA certificado. Si cambia el código de pagos o el binding, ejecutar las suites afectadas y el ensayo antes de certificar el cambio.

## 2. R-MKT-1: intervención humana imprescindible

B ya existe. **No crear otra cuenta y no solicitar/guardar su contraseña.** El titular verifica en su propia sesión que `3796774164` es la cuenta de prueba argentina prevista. La API pública sólo verifica identidad/país. A es también la dueña de TestApp; no sirve como segundo vendedor.

| Paso | Responsable | Acción / evidencia |
|---|---|---|
| H1 | Titular del vendedor B | Consentir el OAuth de TestApp con la cuenta B en su navegador. No Walter ni una cuenta real. |
| H2 | Persona con el comprador QA | Hacer un APRO manual con tarjeta oficial de prueba, ARS 100, una unidad de QA-MKT-001. No automatizar ni eludir el bloqueo de Checkout Pro. |
| H3 | Titular de B, si se certifica devolución externa | «Devolver dinero» desde su actividad; el operador comprueba el resultado del proveedor y su conciliación en B. |

Generar el enlace **cuando H1 esté listo**:

```powershell
node scripts/recovery/qa-mp-e2e.mjs connect-url --tenant b
```

El handler real genera state aleatorio de un uso y PKCE S256. El helper comprueba el host oficial, aplicación TestApp y callback exacto de QA antes de mostrar el enlace. Vale 10 minutos. No guardarlo en Git ni inventar un enlace sustituyendo parámetros; si vence, generar otro. El titular introduce sus datos únicamente en Mercado Pago. Luego:

```powershell
node scripts/recovery/qa-mp-e2e.mjs verify --tenant b
node scripts/recovery/qa-mp-marketplace.mjs identities --seller 3796774164 --reserve 3796774158
```

Exigir conexión B al vendedor correcto y entorno/app verificados. Si aparece otro vendedor, detenerse: el comercio queda ligado al primer vendedor que consiente. No probar con la reserva después de conectar al principal.

## 3. Compra QA y verificación automatizable después de H1

Respetar las coordinaciones de QA existentes y tomar exclusividad de la ventana. No hay motivo para abrir una ventana antes de que H1 termine y la persona H2 esté presente. Esta secuencia sí crea una preferencia de **prueba**, nunca un pago por sí misma:

```powershell
# Baseline v2, nueva y ANTERIOR al checkout. El archivo es obligatorio para certificar.
node scripts/recovery/qa-mp-marketplace.mjs snapshot --out "$ev/baseline.json"
node scripts/recovery/qa-mp-e2e.mjs window-open --tenant b
node scripts/recovery/qa-mp-e2e.mjs checkout --tenant b --sku QA-MKT-001 --scenario APRO
# H2 paga personalmente el init_point devuelto; anotar session y payment id, sin tarjetas ni datos personales.
```

Siempre cerrar la ventana al terminar o ante cualquier error (`finally` en una sesión automatizada). Guardar los ids del resultado como `$session` y `$payment`; no inventarlos. Después del APRO:

```powershell
node scripts/recovery/qa-mp-e2e.mjs worker
node scripts/recovery/qa-mp-e2e.mjs worker
node scripts/recovery/qa-mp-e2e.mjs inspect --tenant b --session $session
node scripts/recovery/qa-mp-marketplace.mjs verify --session $session --seller 3796774164 --baseline "$ev/baseline.json"
node scripts/recovery/qa-mp-e2e.mjs replay-webhook --payment $payment --user-id 3594962708
node scripts/recovery/qa-mp-e2e.mjs replay-webhook --payment $payment --user-id 3796774164
node scripts/recovery/qa-mp-e2e.mjs replay-webhook --payment $payment --user-id 1
node scripts/recovery/qa-mp-e2e.mjs replay-webhook --payment $payment
node scripts/recovery/qa-mp-e2e.mjs worker
node scripts/recovery/qa-mp-e2e.mjs worker
node scripts/recovery/qa-mp-marketplace.mjs verify --session $session --seller 3796774164 --baseline "$ev/baseline.json"
node scripts/recovery/qa-mp-e2e.mjs window-close --tenant b
```

Los replays son avisos firmados generados por el banco sobre un pago real de QA; **no son entregas observadas del proveedor**. Guardar aparte el aviso original de Mercado Pago. Certificar R-MKT-1 sólo con pago B auténtico, aviso original válido/completado en B y cuatro replays verdes; todos deben devolver `all_pass:true` y salida 0. Exigir un pedido e intención nuevos en B, reservas convertidas una vez, descuento exacto y A intacto. Una lectura desconocida, un error de API o falta de baseline no es un PASS.

Si la integradora (también A) puede leer el pago B con HTTP 200, conservar la evidencia y aclarar el permiso de la integradora con Mercado Pago; el verificador no lo transforma en éxito ni certifica aislamiento absoluto del proveedor. RLS y el acceso desde La Taba deben seguir aislados independientemente de ese permiso. No fabricar otro comprobante ni relajar el criterio para cerrar la tarea.

H3, si se realiza, va **después** de capturar la evidencia de compra/stock: inspeccionar y conciliar la devolución como `external`. Eso no aprueba la devolución por API. Ante `in_process`, esperar al proveedor y conservar el seguimiento: no marcar rechazado ni repetir la compra a ciegas. Ante 2034, 503, cobrador erróneo, duplicados o firma inválida aceptada: cerrar ventana y declarar NO-GO.

## 4. Preflight productivo: preparado, prohibido ejecutarlo con escrituras ahora

No existe un ref de producción. El preflight actual se detiene antes de acceder al backend. No completar el binding con QA ni con un proyecto ajeno. Antes de cualquier despliegue hacen falta aprobación de presupuesto/infraestructura y permiso explícito de modificar producción; antes de cualquier cobro, aprobación independiente del titular.

Cuando exista esa autorización, un operador debe completar y aportar evidencia de **cada** fila:

| Gate | Evidencia exigida |
|---|---|
| Destino y release | Proyecto productivo separado, binding revisado, SHA y CI vigente; ningún ref retirado o ajeno. |
| Base y funciones | Todas las migraciones y hashes, nueve funciones ACTIVE y grafo de fuentes correcto, RLS y RPC sensibles sólo para servicio. |
| Aplicación | La Taba Delivery `7677852968049976`, dueña real distinta de Walter, permisos y capacidad de devolución comprobados; callback exacto y webhook registrados por su dueño. |
| Secretos | Carga por canal seguro, cifrado custodiado y worker HMAC sincronizado; **sin llave final** durante la vinculación. El vendedor no entrega secretos. |
| Red | HTTPS, dominio/binding del sitio, callback, CORS y worker; no aceptar saltos como PASS. Firma positiva con el comando `webhook-firma`, sin cambiar claves ni URLs a ciegas. |
| OAuth de Walter | Consentimiento en su dispositivo, identidad del comercio confirmada por servidor y por Walter; cobro apagado. |
| Candado | Alcance `pilot`, ninguna autorización previa abierta ni checkout activo; interruptores global/comercio en el estado de la fase; público en mantenimiento. |
| Conciliación | Cola sana, barrido con heartbeat, cero discrepancias, pagos sin pedido o refunds ambiguos; lectura completa, no truncada. |
| Compra elegida | Documento completo: vendedor, comprador distinto, cliente La Taba, producto no alcohólico, cantidad, ARS exactos, comisiones, devolución y condiciones de aborto. Fecha y huella del documento revisadas. |
| Operación | Backup reciente y restauración vigente, alertas atendidas por operador, retención definida, siete niveles de reversión y pausa de Walter disponibles. |
| Consentimientos | Aprobación expresa del gasto/despliegue, vinculación y luego una compra/devolución. Abrir al público requiere otra aprobación. |

Comandos de lectura para esa fase, sustituyendo valores sólo con los datos del proyecto aprobado:

```text
asistente-activacion.mjs estado
asistente-activacion.mjs red --target production
verificar-configuracion.mjs --ref=produccion --esperado=disabled
piloto-pago-real.mjs plantilla --destino production --salida <archivo FUERA del repo>
piloto-pago-real.mjs validar --archivo <archivo>
piloto-pago-real.mjs preflight --target production --business <uuid> --archivo <archivo> --con-red
```

Cada nombre abreviado está en `scripts/mercadopago/` y se ejecuta con `node`. El JSON de plantilla queda incompleto por diseño: ingeniería no elige los valores comerciales. `ok` automático del preflight deja comprobaciones MANUAL: resolverlas con evidencia antes de autorizar. No interpretar `sin bloqueos` como permiso de mover dinero.

`autorizar` no forma parte de este preflight: es una acción posterior que exige documento, importe y huella explícitos y confirmación de dinero real. Al consumirse sólo admite la compra exacta una vez. Verificar compra antes de devolver; después `verificar-devolucion`, importe/operación del titular y resultado real del proveedor. No marcar la API certificada por una devolución externa. Mantener alcance piloto hasta la aprobación comercial separada.
