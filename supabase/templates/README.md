# Correos de Auth de TABA

Los seis correos que Supabase Auth puede mandar, en castellano rioplatense, y
apuntando a la pantalla `/cuenta/` de este mismo sitio.

## Por qué apuntan a `token_hash` y no a `ConfirmationURL`

La plantilla que viene por defecto usa `{{ .ConfirmationURL }}`, que es un
enlace a `/auth/v1/verify` en el dominio de Supabase: al abrirlo, GoTrue
verifica y **redirige** al `redirect_to` con los tokens de sesión escritos en el
fragmento de la URL.

Eso tiene dos problemas para este producto:

1. **El cliente de la app no lee sesiones de la URL.** Se crea con
   `detectSessionInUrl: false` a propósito: ninguna pantalla acepta una sesión
   que venga escrita en un enlace. Un correo que dependa de eso no aterriza en
   ningún lado.
2. **Un `redirect_to` es una superficie.** GoTrue exime siempre el loopback
   (`http://localhost:cualquier-puerto`), sin importar el `site_url` ni la
   allow-list, y eso no se puede apagar. Mientras los correos no lleven
   `redirect_to`, esa exención no toca ningún flujo real de TABA.

Con `{{ .SiteURL }}/cuenta/?token_hash={{ .TokenHash }}&type=…` el enlace apunta
directo al sitio productivo, y la pantalla canjea el hash con `verifyOtp`, que es
un POST. No hay tokens en la URL y no hay redirección que permitir.

## Cómo se aplican

No se editan en el panel de Supabase. Son la fuente, y viajan con el repo:

```
node scripts/harden-production-auth.mjs --ref wwcpogltfgzgkrlilbcd --templates --apply
```

El guion compara con lo que el proyecto tiene puesto y sólo escribe lo que
difiere, con lectura de vuelta.

## Reglas de la copia

* Corta. Un correo transaccional se lee en cinco segundos.
* Dice **qué se pidió**, **qué hace el enlace** y **qué pasa si no fuiste vos**.
* No promete acceso: confirmar el correo no da membresía en el comercio.
* No usa imágenes ni CSS externo: los clientes de correo los bloquean.
* No dice nunca si un correo está registrado o no.
