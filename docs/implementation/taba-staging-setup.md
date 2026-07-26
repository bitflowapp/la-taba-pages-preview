# Supabase staging para TABA

Estado: preparado, no conectado ni validado contra una instancia real.

## Datos que debe crear/proporcionar el responsable

1. Un proyecto Supabase exclusivo de staging y su `SUPABASE_URL` HTTPS.
2. La clave pública `sb_publishable_...` (o JWT legado con rol `anon`). Nunca
   `service_role`, `sb_secret_`, claves privadas ni JWT privilegiados.
3. UUID del comercio de staging (`TABA_BUSINESS_ID`).
4. Origen público HTTPS de staging y dominios permitidos.
5. Usuarios Auth separados: cliente QA, owner/admin, staff y rider.
6. Membresías activas en `business_members` para owner/admin/staff/rider.
7. Datos comerciales aprobados: modalidades, moneda, tarifa, mínimo, horarios,
   zonas, límites de abuso y política de alcohol.

## Auth

- Habilitar email/password y, si se usará el checkout sin registro, Anonymous
  Sign-Ins.
- Site URL: origen HTTPS exacto de staging.
- Redirect URLs: `https://STAGING_ORIGIN/` y las rutas reales de callback. Para
  local, agregar sólo `http://localhost:4173/`.
- No usar comodines amplios ni incluir dominios de producción antes de aprobarlos.
- Crear usuarios de QA sin reutilizar cuentas reales. La contraseña no se
  documenta ni se commitea.

## Database, RLS y Realtime

Instalar Supabase CLI y Docker según la documentación oficial. Desde la raíz:

```sh
npx supabase --version
npx supabase start
npx supabase db reset
npm run migrations:validate
```

Para staging, vincular explícitamente el proyecto correcto y revisar el diff
antes de aplicar:

```sh
npx supabase link --project-ref PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
```

Realtime debe incluir únicamente las tablas agregadas por migración
(`orders`, `order_items`, `order_events`, `rider_locations`, `products`).
RLS sigue aplicando a los cambios. El tracking por token usa polling y el RPC
DTO; no intenta enviar el bearer por WebSocket.

## Storage

Crear un bucket privado `product-images-staging` sólo si se decide usar Storage.
Tipos permitidos: `image/webp`; tamaño recomendado máximo 500 KB. La publicación
debe hacerse mediante URL pública aprobada o signed URL según la decisión del
negocio. No almacenar DNI, comprobantes con PII ni tokens en este bucket.

## Configuración local y staging

Copiar `.env.example` a `.env` sólo para comandos locales. Copiar
`runtime-config.example.js` al artefacto de staging y reemplazar los valores
públicos. Validar sin imprimir la clave:

```sh
npm run config:check -- path/to/runtime-config.staging.js
npm run staging:validate -- path/to/runtime-config.staging.js path/to/catalog-real.csv
```

`deploymentEnvironment=production` con URL localhost es rechazado. Una
configuración parcial, URL con credenciales, HTTP remoto o clave privilegiada
también es rechazada. El archivo real de runtime no debe contener secretos.
La validación de staging también falla si el catálogo es el template vacío o
si falta cualquier imagen aprobada del manifiesto.

## Secuencia de habilitación

1. Aplicar migraciones desde una base vacía.
2. Crear comercio y memberships con una sesión/admin segura fuera del browser.
3. Importar catálogo validado, inicialmente `available=false`.
4. Configurar límites, alcohol y operación.
5. Con una sesión owner/admin, registrar el WhatsApp público mediante
   `set_business_whatsapp_contact(business_id, telefono, true)`. No actualizar
   `whatsapp_phone` ni los sellos de verificación directamente.
6. Probar Auth/RLS/DTO/rider con cuentas aisladas.
7. Recién después marcar productos verificados y habilitar `ordering_enabled`.

No usar producción ni desplegarla como parte de este runbook.
