# TABA · pedidos de bebidas

PWA mobile-first para catálogo, carrito, checkout, seguimiento, operación del
negocio y reparto. Esta rama incorpora una base de integración con Supabase,
pero **no está habilitada ni certificada para producción**: faltan datos
comerciales validados, credenciales de un entorno de prueba y pruebas reales de
migración, Auth, RLS y Realtime.

## Modos separados

La aplicación decide el modo antes de crear el repositorio de pedidos. No existe
un fallback silencioso de producción a datos simulados.

| Modo | Cómo se activa | Datos y acceso |
| --- | --- | --- |
| Preview seguro | URL normal, sin configuración productiva | No envía pedidos reales ni habilita vistas operativas. |
| Demo | `?demo=1` | Flujo simulado y persistencia local para una presentación. El PIN `1234` existe sólo en este modo. |
| Showcase local | `?showcase=1` | Recorrido guiado de 14 funciones con fixtures sintéticas y almacenamiento aislado. Fuerza sandbox local e ignora cualquier `relay` o runtime Supabase. |
| Producción | `globalThis.__LA_TABA_RUNTIME_CONFIG__` válido | Catálogo, pedidos, Auth y Realtime de Supabase. |
| No disponible | Se solicita producción con configuración inválida o incompleta | Bloqueo explícito; no usa el catálogo demo ni acepta pedidos. |

`?demo=1` siempre selecciona la demo, incluso si el despliegue tiene
configuración productiva. Parámetros como `data`, `api`, `supabaseUrl`, keys,
`relay` o `room` no pueden activar un backend productivo. El relay histórico
queda limitado a la demo.

Para una presentación local limpia:

```text
http://127.0.0.1:8080/?reset=1&demo=1
```

`reset=1` borra una vez el estado local de la demo y luego desaparece de la URL.
No debe utilizarse sobre una sesión operativa.

Para el recorrido comercial guiado:

```text
http://127.0.0.1:8080/?showcase=1&reset=1#home
```

El showcase muestra siempre la etiqueta `Modo demostración local`, utiliza un
namespace separado para estado, Perfil, IndexedDB, BroadcastChannel y rider, y
no consulta Supabase remoto aunque la página reciba configuración productiva o
un parámetro `relay`. Sus productos, pedidos, importes, direcciones y recorridos
son fixtures sintéticas; no acreditan staging, piloto, prueba física ni
producción. Mercado Pago no se presenta como implementado.

## Configuración de despliegue

El pipeline o la plataforma de hosting debe definir la configuración **antes**
de cargar `js/app.js`:

```html
<script>
  globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
    mode: 'production',
    repository: {
      provider: 'supabase',
      supabaseUrl: 'https://PROJECT_REF.supabase.co',
      publishableKey: 'PUBLISHABLE_KEY_DEL_ENTORNO',
      businessId: 'UUID_DEL_COMERCIO',
      pollMs: 5000
    }
  };
</script>
<script type="module" src="js/app.js"></script>
```

Reglas:

- usar la URL HTTPS, la publishable key y el UUID del entorno correcto;
- no usar ni exponer llaves privilegiadas de servidor, secretos administrativos o contraseñas;
- no pasar configuración por query string;
- no commitear valores de un entorno real en `index.html`;
- tratar una configuración ausente como preview y una configuración productiva
  incompleta como indisponibilidad;
- invalidar el caché del service worker en cada cambio de configuración o
  versión desplegada.

Este repositorio todavía no incluye un inyector automático de configuración para
hosting. Esa etapa del pipeline debe implementarse y verificarse antes de
publicar un entorno operativo.

## Flujo productivo implementado

1. El navegador carga sólo productos activos, disponibles y verificados del
   comercio configurado.
2. El cliente obtiene una sesión anónima de Supabase Auth.
3. El checkout envía a la RPC únicamente identidad de producto, cantidad y los
   datos mínimos del cliente.
4. PostgreSQL bloquea productos, valida negocio y stock, calcula precios,
   subtotal, envío y total, genera identificadores y persiste pedido, ítems,
   evento y digest del token de seguimiento en una transacción.
5. Negocio y rider inician sesión con email y contraseña; el rol se valida en
   `business_members`.
6. Los cambios de estado pasan por una RPC con estado esperado, permisos por rol
   y control de concurrencia.
7. Supabase Realtime notifica sesiones Auth; el polling respalda caídas y es el
   mecanismo continuo para recuperación mediante token público.
8. Un rider asignado puede publicar únicamente fixes obtenidos de GPS real.

La base de datos es la autoridad. Los precios, totales, stock, estado, UUID del
pedido y código público se generan o validan en el servidor; `localStorage` no
es el registro operativo.

## Auth y roles

- Cliente: sesión anónima de Supabase Auth; puede crear un pedido y consultar el
  suyo según RLS.
- `owner`: titular administrador, con operación y gestión autorizada de
  membresías/activación.
- `admin`: administración de pedidos y catálogo del comercio.
- `staff`: operación cotidiana de pedidos y catálogo según las policies.
- `rider`: acceso sólo a repartos disponibles/asignados y GPS del pedido propio.

Las cuentas del equipo usan email y contraseña. No hay PIN productivo. La
membresía debe pertenecer al `businessId`, tener un rol permitido y estar
activa; la UI ayuda a separar vistas, pero la autorización definitiva está en
RLS y en las RPC.

## Catálogo de bebidas

La migración productiva no crea productos, precios, stock, imágenes ni
condiciones comerciales. Cada fila debe contar con datos verificados de nombre,
marca, categoría, subcategoría, presentación, capacidad, envase, precio, stock,
condición alcohólica, imagen y etiquetas. También deben validarse moneda,
delivery/retiro, tarifa y mínimo del comercio.

Hasta completar esa validación humana:

- `is_verified` y `available` permanecen desactivados;
- `ordering_verified` y `ordering_enabled` permanecen desactivados;
- producción muestra catálogo vacío o indisponible y no acepta checkout;
- no se deben copiar productos de la demo ni inventar valores para “completar”
  la interfaz.

## Desarrollo y verificación local

Requisitos: Node.js y Python.

```powershell
npm ci
npm run vendor:build
python -m http.server 8080
```

Verificaciones sin infraestructura externa:

```powershell
npm run check
npm test
npm run test:e2e
```

Verificación completa:

```powershell
npm run verify
```

El smoke real de Supabase se ejecuta con `npm run smoke:supabase`, crea y cambia
datos en la instancia indicada y exige
`TABA_SMOKE_CONFIRM=I_UNDERSTAND_THIS_CREATES_AN_ORDER`. Requiere además URL,
publishable key, UUID de comercio, cuenta operativa de prueba y teléfono del
cliente; las variables exactas están en el
[runbook](docs/implementation/taba-production-operations.md#smoke-mutante). No
debe ejecutarse contra producción ni sin revisar antes el entorno.
En esta ejecución quedó **no ejecutado**: no hay Supabase CLI, instancia,
URL/keys ni cuentas de prueba disponibles.

## Build y despliegue

```powershell
npm run release:folder
```

`release:folder` reconstruye el vendor, ejecuta `check`, unitarias y E2E, valida
las fuentes y genera el artefacto en una carpeta temporal antes de reemplazar
`dist_release`. El artefacto contiene sólo el runtime web; auditorías y runbooks
permanecen en el repositorio. Aun así, se debe resguardar cualquier contenido
local relevante. El resultado todavía necesita la inyección de runtime config
del entorno y una validación de staging. No desplegar hasta completar
migraciones, catálogo, Auth/RLS, smoke, Realtime, PWA real, responsive, consola
del navegador, rollback, backups y monitoreo.

Guías relacionadas:

- [Plan técnico](docs/implementation/taba-production-plan.md)
- [Runbook de integración y despliegue](docs/implementation/taba-production-operations.md)
- [Evidencia de validación local](docs/audit/taba-production-validation.md)
- [Migraciones y controles de Supabase](supabase/README.md)
