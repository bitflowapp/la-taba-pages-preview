# Dependencias de lanzamiento: estado al cierre de esta etapa

## Configuración que debe completar el operador

Las [instrucciones exactas](2026-10-21-mercadopago-configuration-handoff.md) incluyen las URLs derivadas del código y todos los nombres de variables realmente usados.

1. En **TABA2 Staging 2691240967769590**, registrar el callback OAuth, habilitar PKCE S256 y revisar permisos read/write/offline_access.
2. Copiar la firma completa de Webhooks directamente a `MERCADOPAGO_OAUTH_WEBHOOK_SECRET` en Supabase. Es el único secreto de pagos que falta en el preflight. No pedir ni enviar secretos por chat.

Cloudflare recuperó acceso renovando la sesión existente; no necesita intervención manual ahora. No hubo despliegues. La autorización de la cuenta comercial de Walter está documentada mediante consentimiento oficial, state y PKCE; **no se emitió un vínculo comercial desde staging**.

## Trabajo autónomo realizado

| Área | Estado |
|---|---|
| Configuración de pagos | Nombres y hashes verificados; sin divergencias; falta firma webhook |
| Circuito remoto de Mercado Pago | Preparado por etapas; todavía no ejecutado contra el proveedor |
| Pruebas locales | 241 aprobadas, cero fallos; log sin secretos |
| Backup de la base alojada | Dos snapshots cifrados, exportación de roles sin contraseñas y manifiestos |
| Restauración de aplicación | Dos ensayos aislados aprobados: 151 tablas, 74 políticas, 458 funciones, permisos y publicación coincidentes |
| Plataforma Supabase completa | Pendiente: restricciones de pg_cron y privilegios de componentes administrados documentadas |
| Copias de ensayo | Eliminadas tras verificar; cero bases taba_restore_* restantes |
| Git | Rama remota en bitflowapp/la-taba-pages-preview, conservando 3123704d; sin merge ni publicación |
| Datos comerciales | 72 productos privados; cero productos públicos, pedidos, pagos o configuraciones de pago activas |
| Infraestructura | La Taba Free, sa-east-1, ACTIVE_HEALTHY, costo adicional USD 0 |

Las pruebas locales inicialmente encontraron archivos omitidos por el checkout reducido y una unión a dependencias fuera del árbol. Se copiaron las dependencias existentes a D: y se recuperaron los archivos necesarios; no se debilitaron los controles de identidad del código. La repetición final pasó. No se instalaron navegadores ni imágenes Docker.

## Git y protección de datos

El repositorio existente es **público**. La copia remota contiene código y evidencia sin secretos; los dumps cifrados y la clave no se subieron. Los commits usan `[CF-Pages-Skip] [skip ci]` y la rama no coincide con las ramas de despliegue. No se abrió PR con despliegue, no se hizo merge y no se ejecutaron workflows productivos.

La copia de trabajo actual está en un directorio local privado con dependencias locales. La base Git todavía puede leer objetos previos mediante alternates hacia el repositorio original; la copia remota conserva de forma independiente los commits y su historia. No eliminar el repositorio original sin preparar antes una copia Git local independiente.

## Pendientes adicionales antes del GO

- OAuth y pago real **de prueba**, webhook auténtico, idempotencia, cancelación, reembolso y reconciliación remotos.
- Entorno de frontend de verificación accesible, previa aprobación de publicación; no se publicó la tienda.
- Revisión de advertencias de autorización heredadas, correo Auth y notificaciones al comercio.
- Recuperación de servicios Supabase administrados en una plataforma aislada compatible, custodia externa de la clave y backups automáticos/offsite.
- Validación comercial de Walter: precios, costos, stock, imágenes, entregas e identidad administrativa.

**NO-GO comercial.** El trabajo deja instrucciones concretas para completar las autorizaciones y continuar QA sin habilitar cobros reales.

## Evidencia

Directorio [launch-dependencies-evidence](2026-10-21-launch-dependencies-evidence/): preflight, inventario de variables desde fuentes, backup, restauración, limpieza, estado final de Supabase y log local. Los detalles y archivos cifrados permanecen en un almacén local privado, fuera de Git.
