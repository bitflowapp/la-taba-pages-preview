# Cutover de DNS · plan

**Nada de esto se ejecutó.** El DNS es el último cambio visible y se hace después
de que auth, pagos y firma estén cerrados.

Falta un dato: **el hostname**, y dónde se administra su DNS. Ver
`EXTERNAL-GATES.md` §1 y §2.

---

## Lo que sí se sabe, con evidencia

| | |
|---|---|
| plataforma del frontend | **Cloudflare Pages** — staging vive en `taba2-staging.pages.dev` |
| reloj externo | **Cloudflare Worker** (`services/scheduler-watchdog/`) |
| proyecto de Pages de staging | sin proveedor de git: los despliegues son subidas manuales |
| proyecto de Pages de producción | **no existe todavía** |
| addon «Custom Domain» de Supabase | disponible, **no contratado** (USD 10/mes) — sólo hace falta si se quiere que la API de Supabase responda en un dominio propio; para el sitio no |

No hay `wrangler` instalado ni credenciales de Cloudflare en esta máquina, así
que no puedo leer la zona ni confirmar dónde está delegado el dominio.

---

## Registros, según dónde esté el DNS

### Si el dominio está delegado a Cloudflare
Es el camino corto: al agregar el dominio personalizado en el proyecto de Pages,
Cloudflare crea el registro solo.

| nombre | tipo | valor | proxy |
|---|---|---|---|
| `@` o `pedidos` | CNAME | `<proyecto>.pages.dev` | activado |
| `www` | CNAME | `@` | activado |

En el ápice, Cloudflare resuelve el CNAME por *flattening*; en otro proveedor eso
no existe y hace falta `ALIAS`/`ANAME`, o usar un subdominio.

### Si el DNS está en el registrador
| nombre | tipo | valor |
|---|---|---|
| `pedidos` | CNAME | `<proyecto>.pages.dev` |
| `@` | ALIAS/ANAME | `<proyecto>.pages.dev` — si el proveedor no lo soporta, **usar subdominio** |
| `_acme-challenge` | TXT | el que pida la validación, si es manual |

---

## TTL

Bajar el TTL a **300 s** al menos **24 h antes** del cutover, y devolverlo a
3600 s cuando esté estable. Es lo que convierte un error en quince minutos de
molestia en vez de un día.

---

## Orden

1. Bajar TTL a 300. Esperar 24 h.
2. Crear el proyecto de Pages de producción y subir `dist_release`, con el
   `runtime-config.js` productivo ya inyectado.
3. Verificar sobre la URL `*.pages.dev` **antes** de tocar el dominio:
   ```bash
   curl -s https://<proyecto>.pages.dev/runtime-config.js | sha256sum
   ```
   Tiene que dar el hash del config preservado, no el de la plantilla.
4. Agregar el dominio personalizado en Pages. Esperar el certificado.
5. Crear/actualizar el registro.
6. Cerrar auth con el dominio real (`EXTERNAL-GATES.md` §1).
7. Cargar `TABA_ALLOWED_ORIGINS` y `TABA_CHECKOUT_BASE_URL` con ese dominio y
   redesplegar las Edge Functions.
8. Comprobación posterior (abajo).
9. Devolver el TTL a 3600.

---

## Comprobación posterior

```bash
dig +short <host>                       # resuelve al destino nuevo
curl -sI https://<host> | head -3       # 200, y HSTS si corresponde
curl -s https://<host>/runtime-config.js | sha256sum
openssl s_client -connect <host>:443 -servername <host> </dev/null 2>/dev/null \
  | openssl x509 -noout -dates -subject
curl -sI http://<host> | head -3        # tiene que redirigir a https
```

Y desde el navegador, con la consola abierta: que no haya un solo error de CORS
ni de auth. Un fallo de CORS acá significa que `TABA_ALLOWED_ORIGINS` quedó con
el dominio viejo.

---

## Rollback

| capa | cómo |
|---|---|
| DNS | volver el registro al valor anterior. Con TTL 300, cinco minutos. |
| dominio en Pages | quitarlo del proyecto; `*.pages.dev` sigue sirviendo |
| auth | restaurar `site_url` y `uri_allow_list` desde `security/AUTH-CONFIG-*.json` |
| Edge Functions | volver a poner el `TABA_ALLOWED_ORIGINS` anterior y redesplegar |

El orden del rollback es el inverso del cutover. Y el primer movimiento ante
cualquier duda operativa no es el DNS: es cerrar la persiana
(`ordering_enabled = false`), que se hace en un `update` y no espera propagación.

---

## Propagación

Con TTL 300 previo, la mayoría de los resolutores toman el cambio en 5–15 min.
Los que ignoran el TTL pueden tardar horas. Por eso el sitio nuevo tiene que
estar sirviendo **antes** de mover el registro: durante la propagación conviven
las dos respuestas, y las dos tienen que funcionar.
