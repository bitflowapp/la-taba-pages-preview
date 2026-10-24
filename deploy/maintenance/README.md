# Página de mantenimiento para `la-taba.pages.dev` (preparada, NO publicada)

`la-taba.pages.dev` sirve hoy la v144 con un `runtime-config.js` que apunta a un proyecto de Supabase que ya no existe: la tienda carga y no puede mostrar ni vender nada. Esta carpeta es el reemplazo neutro hasta que exista el proyecto de producción y se publique el sitio nuevo:

- `index.html`: «Estamos preparando la tienda» — sin precios, productos, teléfonos, direcciones ni datos del comercio (nada de demostración presentado como real);
- `sw.js`: retira el service worker de la v144 de los teléfonos que ya la tenían (borra cachés, se da de baja y recarga);
- `_headers`: `noindex` y sin caché para la página y el worker.

## Publicar (decisión de Marco: es la producción existente)

```
npx wrangler@4 pages deploy deploy/maintenance --project-name la-taba --branch main --commit-dirty=true
```

`scripts/recovery/pages-direct-deploy.mjs` rechaza a propósito la rama de producción de un proyecto: este paso lo hace una persona con su sesión de Cloudflare.

## Volver atrás

Cloudflare Pages conserva los despliegues: en el panel del proyecto `la-taba`, «Rollback» al despliegue anterior. Cuando exista el proyecto de producción, `Deploy production` publica el sitio nuevo encima de esta página.
