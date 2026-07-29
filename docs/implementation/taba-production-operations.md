# Runbook de integración y despliegue de TABA

Estado al 25 de julio de 2026: implementación técnica en curso. Este documento
describe cómo validar la rama `feat/taba-production-beverages`; **no autoriza un
despliegue productivo**.

## 1. Alcance y reglas de seguridad

- Repositorio vigente: `<REPO_ROOT>`.
- Demo y producción son sistemas separados.
- La demo se habilita sólo con `?demo=1` y usa datos locales/simulados.
- Producción se habilita sólo con `__LA_TABA_RUNTIME_CONFIG__` completo.
- Una configuración productiva inválida debe bloquear, no volver a la demo.
- PostgreSQL es la autoridad de catálogo, stock, precios, totales, IDs y estados.
- No usar llaves privilegiadas de servidor en el navegador.
- No inventar productos, precios, stock, imágenes, horarios, zonas, tarifas,
  mínimos ni identidad del comercio.
- No ejecutar migraciones o smoke contra una instancia remota sin identificar
  el target y contar con autorización, backup y rollback.

## 2. Prerrequisitos de un entorno aislado

Antes de probar la integración real se necesita:

1. proyecto Supabase de staging, distinto de producción;
2. URL HTTPS y publishable key;
3. Supabase CLI y runtime local, o acceso autorizado al proyecto de staging;
4. UUID de un comercio de prueba;
5. Auth anónimo habilitado;
6. usuarios email/password separados para `owner`, `admin`, `staff` y `rider`;
7. memberships activas de esos usuarios para el comercio;
8. catálogo de prueba revisado y claramente identificado como tal;
9. segundo navegador o dispositivo para validar Realtime;
10. ubicación/GPS de prueba con consentimiento;
11. política de limpieza de los datos que cree el smoke.

No reutilizar cuentas personales, claves de producción ni datos reales de
clientes.

## 3. Preparar y aplicar la base

### Entorno local descartable

```powershell
supabase start
supabase db reset
supabase status
```

`db reset` elimina el contenido de la base local. Confirmar que el target sea el
entorno local descartable antes de ejecutarlo.

### Staging remoto

1. registrar project ref, fecha, responsable y checksum del backup;
2. probar restauración o, como mínimo, verificar que el backup sea legible;
3. aplicar las migraciones en el orden documentado en `supabase/README.md`;
4. capturar errores, warnings y notices;
5. inspeccionar constraints, grants, policies, funciones y publication;
6. comprobar que productos y ordering quedaron deshabilitados por defecto;
7. comprobar que `supabase/seed.sql` sigue vacío y no crea catálogo ficticio;
8. no continuar si una policy permisiva de las fases piloto sigue activa.

No hay un procedimiento automático de rollback versionado. Hasta crearlo y
ensayarlo, una migración remota es una compuerta bloqueante.

## 4. Bootstrap de Auth y memberships

1. Habilitar sign-in anónimo con rate limits y protección antiabuso apropiados.
2. Crear usuarios de prueba mediante Supabase Auth; no guardar contraseñas en
   SQL, commits, capturas ni logs.
3. Insertar memberships activas para el `business_id` correcto: `owner`,
   `admin`, `staff` y `rider`.
4. Probar cada cuenta desde una sesión de navegador independiente.
5. Verificar rechazo de:
   - usuario sin membership;
   - membership inactiva;
   - membership de otro comercio;
   - owner/admin/staff en la vista rider;
   - rider en la vista negocio;
   - actor anónimo intentando mutaciones operativas.

El PIN `1234` pertenece exclusivamente a `?demo=1`; no forma parte de Auth ni
puede utilizarse como credencial operativa.

## 5. Cargar y validar datos comerciales

### Comercio

La persona responsable debe confirmar:

- nombre e identidad del comercio;
- moneda ISO de tres letras;
- estado abierto/activo;
- delivery y/o retiro;
- tarifa y mínimo para delivery;
- condiciones, cobertura y datos de contacto publicados.

Recién después se registran verificador y fecha y se habilitan
`ordering_verified` y `ordering_enabled`.

### Productos

Para cada bebida validar:

- nombre, marca, categoría y subcategoría;
- presentación, capacidad y envase;
- precio y stock;
- si es alcohólica;
- imagen correcta, accesible y con derecho de uso;
- etiquetas relevantes;
- estado activo, disponibilidad, verificador y fecha.

La carga debe venir de una fuente aprobada por el comercio. No copiar el
catálogo demo, no inferir precios desde competidores y no descargar imágenes al
azar.

Antes de habilitar pedidos, comparar una muestra del frontend con las filas de
PostgreSQL y obtener aprobación explícita del comercio.

## 6. Configurar el frontend

El artefacto de staging debe definir este objeto antes de `js/app.js`:

```js
globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
  mode: 'production',
  repository: {
    provider: 'supabase',
    supabaseUrl: 'https://PROJECT_REF.supabase.co',
    publishableKey: 'PUBLISHABLE_KEY_DE_STAGING',
    businessId: 'UUID_DEL_COMERCIO_DE_STAGING',
    pollMs: 5000,
  },
};
```

Validaciones:

- URL y UUID corresponden al mismo entorno;
- no hay credenciales en query strings;
- no aparecen llaves privilegiadas de servidor en fuentes, bundle, HTML, network ni logs;
- quitar un campo deja la aplicación explícitamente indisponible;
- `?demo=1` nunca realiza requests al proyecto;
- la URL normal no cae en productos o pedidos simulados;
- el service worker entrega la misma versión de HTML, JS y runtime config.

La generación de `dist_release` no inyecta esta configuración automáticamente.
El pipeline de despliegue debe hacerlo sobre el artefacto, sin modificar ni
commitear el valor real en el fuente.

## 7. Verificación

### Suite local sin infraestructura

```powershell
npm ci
npm run vendor:build
npm run check
npm test
npm run test:e2e
```

Registrar versión de Node, commit, rama, hora de inicio/fin y conteo de pruebas.
Una suite con mocks valida contratos, no RLS o transacciones reales.

### Matriz real de Supabase

En staging deben verificarse como mínimo:

1. catálogo vacío cuando no hay productos verificados;
2. producto pausado o sin stock no visible/no comprable;
3. cliente anónimo autenticado;
4. checkout con sólo UUID y cantidad;
5. rechazo de precio, total, estado o campos extra enviados por cliente;
6. cálculo server-side de subtotal, tarifa, total y moneda;
7. persistencia atómica de pedido, ítems, evento y digest del token;
8. mismo request ID + mismo payload devuelve el mismo pedido;
9. mismo request ID + payload distinto falla;
10. dos compras concurrentes no producen stock negativo;
11. transición con estado esperado obsoleto falla;
12. cancelación/rechazo restituye stock exactamente una vez;
13. cliente no puede leer pedidos ajenos;
14. owner/admin/staff no pueden operar otro comercio;
15. rider no puede tomar o publicar GPS sobre pedido ajeno;
16. GPS no real o `source` distinto de `gps` falla/no se expone;
    verificar además que `created_at` sea la hora del servidor y definir la
    política humana/técnica ante coordenadas o saltos físicamente imposibles;
17. token incorrecto, vencido o revocado no permite tracking;
18. Realtime actualiza cliente, negocio, rider y catálogo;
19. caída de Realtime activa el polling sin duplicar acciones;
20. recarga, cierre de sesión y pérdida de almacenamiento no alteran la verdad
    persistida.

### Smoke mutante

El comando es:

```powershell
npm run smoke:supabase
```

Variables obligatorias:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY  (o SUPABASE_ANON_KEY)
SUPABASE_BUSINESS_ID
SUPABASE_STAFF_EMAIL
SUPABASE_STAFF_PASSWORD
TABA_SMOKE_CUSTOMER_PHONE
TABA_SMOKE_CONFIRM=I_UNDERSTAND_THIS_CREATES_AN_ORDER
```

Variables opcionales:

```text
TABA_SMOKE_CUSTOMER_NAME
TABA_SMOKE_DELIVERY_MODE=delivery|pickup
TABA_SMOKE_STREET_ADDRESS
```

La dirección es obligatoria si el modo resuelto es delivery. La cuenta operativa
debe tener una membership activa `owner`, `admin` o `staff`.

Antes de correr:

- imprimir sólo URL/project ref y valores no secretos;
- verificar que el comercio y los productos estén marcados como prueba;
- asumir que quedarán el pedido cancelado y sus eventos como evidencia; el
  script restituye stock, pero no elimina filas;
- abrir una segunda sesión para observar Realtime;
- guardar stdout/stderr redacted como evidencia.

En el entorno actual este smoke no se ejecutó: faltan CLI/runtime, instancia,
credenciales, cuentas y autorización para mutar datos reales.

## 8. Build, staging y rollout

1. resguardar cualquier `dist_release` existente que deba conservarse;
2. ejecutar:

   ```powershell
   npm run release:folder
   ```

   El comando reconstruye el bundle local, ejecuta `check`, unitarias y E2E y
   genera primero una carpeta temporal; si el reemplazo falla, restaura el
   artefacto anterior. `dist_release` contiene sólo el runtime web; la
   documentación operativa y las auditorías permanecen en el repositorio.
3. inyectar runtime config de staging en el artefacto;
4. desplegar staging con HTTPS;
5. verificar rutas directas, manifest, iconos, service worker y offline/error;
6. revisar Network y consola sin errores ni secretos;
7. probar 320, 360, 390, 412, 432, 768 y 1280 px sin overflow;
8. ejecutar la matriz real y el smoke;
9. obtener aprobación de catálogo y operación;
10. preparar versión de rollback y ensayar reversión de frontend;
11. recién entonces evaluar un rollout limitado.

No reutilizar el sitio de preview/demo como producción sin separar configuración,
caché, datos y observabilidad.

## 9. Evidencia y criterio de salida

Cada ejecución debe producir:

- commit y artefacto exactos;
- estado Git previo y posterior;
- checksums del backup y del build;
- resultado de migraciones;
- matriz RLS por actor;
- conteos de unit/integration/E2E;
- evidencia del smoke e idempotencia;
- evidencia de Realtime multi-dispositivo;
- capturas responsive;
- revisión de consola, rutas y assets;
- incidencias conocidas, owner y fecha objetivo;
- procedimiento probado de rollback.

Bloqueos de seguridad que deben cerrarse antes de habilitar pedidos:

- límites/CAPTCHA o control antiabuso para altas anónimas y reservas de stock;
- una cola sanitizada para que un rider todavía no asignado no reciba toda la
  PII del pedido;
- una vista/RPC sanitizada para tracking por token, con rotación y revocación
  operativa, en lugar de exponer filas completas por PostgREST;
- política de retención de pedidos, tokens y ubicaciones;
- pruebas de abuso de GPS; la hora ya es autoritativa del servidor, pero una web
  no puede demostrar por sí sola que una coordenada no fue falsificada.

Al 25 de julio de 2026 no están disponibles la infraestructura y credenciales
necesarias para esa evidencia real. Por lo tanto, el criterio de salida
productiva permanece abierto.
