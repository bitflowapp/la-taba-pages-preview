# Volver al deployment anterior

Cloudflare Pages **conserva los deployments anteriores**: volver atrás es
promover uno viejo, no reconstruir nada. Segundos, no minutos.

**No hay rollback automático, y es a propósito.** Un rollback a ciegas puede
devolver producción a una versión que no habla con la base actual —una migración
aplicada en el medio, un contrato de catálogo cambiado— y eso es peor que el
defecto que se quería revertir. Alguien tiene que mirar antes.

## 1 · Saber qué hay publicado ahora

```
node scripts/deploy/verificar-publicado.mjs
```

```
  commit publicado    956fa74f1229d0157ad6ff85fb811839a6beceea
  runtime publicado   la-taba-runtime-v85-pildora-del-mapa
  construido          2026-08-24T03:58:44.221Z
```

Si el sitio no publica `version.json`, el despliegue es anterior al sello: el
runtime se lee igual del `sw.js` que informa el mismo comando.

## 2 · Ver los deployments y elegir

```
npx wrangler@4 pages deployment list --project-name la-taba
```

Cada fila trae su id, la fecha y el commit con el que se publicó (los despliegues
automáticos pasan `--commit-hash`, así que el SHA está ahí).

Antes de elegir, saber del candidato:

| dato | dónde sale |
|---|---|
| deployment id | la lista de arriba |
| SHA | la misma lista, o `https://<deployment>.la-taba.pages.dev/version.json` |
| runtime | ese mismo `version.json`, o el `sw.js` de esa URL |

Cada deployment tiene su propia URL, así que **se puede inspeccionar antes de
promoverlo**:

```
node scripts/deploy/verificar-publicado.mjs --host https://<deployment>.la-taba.pages.dev
```

## 3 · Promover

Panel de Cloudflare → proyecto `la-taba` → *Deployments* → el deployment →
**Rollback to this deployment**.

## 4 · Comprobar

```
node scripts/deploy/verificar-publicado.mjs --esperar-commit <sha al que volviste>
```

## Lo que un rollback NO revierte

- **Migraciones de base.** El esquema queda como está. Si el problema vino de
  una migración, el rollback del frente no lo arregla.
- **Datos.** Pedidos, stock y precios no se tocan.
- **La caché de quien ya cargó la página.** El service worker es *network
  first* y su `CACHE_NAME` va versionado, así que la vuelta atrás llega sola en
  la siguiente carga. Nadie tiene que borrar nada.

## Después del rollback

Producción queda **adelante o atrás** de `main` a propósito, y el próximo merge
a `main` con CI verde vuelve a desplegar automáticamente — posiblemente el mismo
defecto.

Así que un rollback pide una de estas dos, enseguida:

1. revertir el commit culpable en `main`, o
2. desactivar el workflow *Deploy production* hasta tener el arreglo.

Dejarlo sin decidir es cómo un rollback se deshace solo veinte minutos después.
