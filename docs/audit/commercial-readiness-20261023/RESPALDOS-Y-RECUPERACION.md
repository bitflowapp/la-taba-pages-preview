# Respaldos, restauración y recuperación ante desastres

24/10/2026. Lo medido es sobre QA (`ixewllzzuzpqrkxzmfzx`, dinero ficticio); lo de producción queda preparado y sin ejecutar porque el proyecto no existe. No se borró ningún respaldo ni base de restauración.

## 1. Lo que hay y lo que se verificó hoy

| Pieza | Estado | Evidencia |
|---|---|---|
| Respaldo cifrado de QA (`pg_dump` custom + roles sin contraseñas, AES-256-GCM con metadatos autenticados, TLS `verify-full`, ida y vuelta verificada antes de escribir) | 4 instantáneas: `qa-pre-210000` (23/10), `qa-pre-240100` y `qa-pre-240200` (24/10, antes de cada migración de hoy) | `despliegue-qa/respaldo-previo-manifest.json` |
| Integridad | Los SHA-256 del texto cifrado de base y roles coinciden con su manifiesto en todas las instantáneas revisadas | recálculo local de hashes |
| Frescura | `backup-freshness.mjs` → `ok`, 0,1 h | salida del guion |
| Restauración **alojada** (otra base en el mismo clúster, 23/10) | 154 tablas, 74 políticas, 503 funciones, RLS, ACL y publicación coinciden con el archivo | `../mercadopago-final-20261023/despliegue-qa-20261023/` |
| Restauración **local, sin Supabase** (nueva: `scripts/recovery/local-restore-drill.mjs`) | Desde el archivo cifrado a un PostgreSQL local vacío: conteos iguales al manifiesto (8 usuarios, 3 productos, 7 pedidos, 172 migraciones), 106 tablas con RLS, 79 políticas, 503 funciones; las compuertas de dinero ejecutan sobre lo restaurado (0 cobrados sin pedido, 0 stock negativo, 1 pedido reembolsado) | `despliegue-qa/ensayo-restauracion-local.json` |
| **Tiempo de recuperación de la capa de datos** | **15 a 40 s** (descifrar 0,5–1,2 s; pre-datos 4–7 s; datos 1–3 s; post-datos 4–13 s; permisos y verificación 1–8 s), según la carga de la PC | dos corridas |

## 2. Controles de acceso

| Control | Estado | Riesgo | Acción |
|---|---|---|---|
| Los respaldos nunca van al repositorio | La herramienta exige carpeta nueva en D:, fuera de cualquier checkout de Git (`private-output.mjs`); la regla de higiene rechaza rutas locales en archivos versionados. **El repositorio es público**: no hay otra opción segura | — | mantener |
| Clave de cifrado | Administrador de credenciales de Windows del usuario (protegida por DPAPI), atada al ref del proyecto | **Punto único**: si la PC se pierde, los respaldos no se pueden abrir | **D4**: copia de la clave en custodia separada (gestor de contraseñas del titular o sobre cerrado), nunca junto al respaldo |
| Carpeta de respaldos | Hereda `Usuarios: lectura` de la carpeta de trabajo del disco de datos | Bajo: sólo hay texto cifrado y la clave no es legible por otros usuarios | Opcional: `icacls` para dejar sólo al titular, SYSTEM y Administradores |
| Contraseña de la base | Administrador de credenciales, usuario = ref | — | Producción usa su propia entrada (`PRODUCTION DB PASSWORD`) |

## 3. Qué NO cubre un `pg_dump` (se repone aparte)

| Pieza | Cómo se repone |
|---|---|
| Bytes de las fotos (Storage) | desde la fuente original o con una exportación del bucket; hoy QA tiene 0 objetos y **producción debe cargar las fotos desde las fuentes con derechos** |
| Secretos de las funciones y de Vault (HMAC del worker) | `configurar-oauth-produccion.ps1` y `sincronizar-worker-hmac.mjs --target=production --apply` |
| Estado de los cron | `deploy.mjs schedulers --enable …` |
| Configuración de Auth (SMTP, URL del sitio) | `harden-production-auth.mjs`; el manifiesto guarda el subconjunto seguro para comparar |
| Funciones | `deploy.mjs functions all --apply` desde el SHA del respaldo |
| Aplicación de Mercado Pago (URLs) y Cloudflare Pages | sesión del dueño de la aplicación; `Deploy production` |
| **Conexiones de Mercado Pago de los vendedores** | Los tokens se sellan con el ref del proyecto como dato autenticado (`MERCADOPAGO_OAUTH_PROJECT_REF`): **en un proyecto nuevo no se pueden abrir y el comercio tiene que reconectar** (Panel → Mercado Pago → Conectar). Es una defensa a propósito, no un defecto |

## 4. Producción: lo que quedó preparado

- `scripts/production/backup.mjs`: el mismo sobre que QA, con la guardia de producción (registro, organización paga, región, marca de la base) y credenciales propias (`PRODUCTION DB PASSWORD`, `PRODUCTION BACKUP ENCRYPTION KEY`). Sin proyecto sale 2 sin leer nada.
- `scripts/recovery/local-restore-drill.mjs --environment production`: el mismo ensayo local, con la clave de producción.
- `backup-freshness.mjs --root <carpeta> --max-hours 26`: alarma de respaldo viejo (ya existía).

### Plan de respaldos propuesto (costo mínimo)

| Capa | Qué | Costo | Cubre |
|---|---|---|---|
| 1 | Copias diarias gestionadas del plan Pro (7 días) | incluido en el plan (D1) | error de datos reciente; **no** cubre el borrado del proyecto |
| 2 | `scripts/production/backup.mjs` en la PC de operación, con el Programador de tareas de Windows: cada 6 h durante la apertura, diario después | USD 0 | borrado del proyecto, error lógico detectado tarde |
| 3 | Copia **fuera de la PC** del archivo cifrado (`prepare-offsite-backup.mjs` arma el paquete sin la clave) al destino D4 | USD 0 con un medio propio sano o una nube personal | pérdida o rotura de la PC |
| — | PITR del proveedor | add-on de pago | no se recomienda para el volumen inicial |

RPO resultante: ≤ 24 h con la capa 1; ≤ 6 h con la capa 2. **El RPO/RTO lo acepta Walter (D3)**.

Antes de abrir: correr una vez `backup.mjs` + `local-restore-drill.mjs --environment production` sobre el proyecto nuevo (todavía sin clientes) y guardar el tiempo medido.

## 5. Recuperación ante desastres (runbook)

| Escenario | Qué hacer | RTO estimado |
|---|---|---|
| Un dato roto (pedido, stock, precio) | corregirlo con las herramientas del Panel o una migración nueva; nunca editar a mano sin respaldo previo | minutos |
| Error lógico de las últimas horas | restaurar la copia gestionada del día (panel de Supabase) **o** restaurar datos desde el último `backup.mjs` a una base aparte y copiar lo necesario | 1–2 h |
| **El proyecto se pierde** | 1) [AUTORIZACIÓN] proyecto nuevo · 2) `bind-production.mjs` con el ref nuevo (PR + CI) · 3) `deploy.mjs bootstrap` desde el SHA del respaldo · 4) restaurar los datos del respaldo cifrado (esquemas de aplicación y Auth, como en el ensayo) · 5) funciones, secretos, Vault, cron, Auth · 6) dueño de La Taba Delivery: URLs nuevas de OAuth y webhook · 7) Walter reconecta Mercado Pago · 8) `Deploy production` y smoke | **3–4 h** con las personas disponibles; la capa de datos son segundos, el resto es plataforma y personas |
| La PC de operación se pierde | clave desde la custodia D4; respaldos desde la copia externa; credenciales nuevas | depende de D4 |

El paso 4 sobre un proyecto **nuevo** no está ensayado: sólo se ensayó sobre otra base del mismo clúster y sobre PostgreSQL local. Ensayarlo exige un segundo proyecto por unas horas (costo de cómputo por hora, menor a USD 1 por ensayo): **[AUTORIZACIÓN]**.
