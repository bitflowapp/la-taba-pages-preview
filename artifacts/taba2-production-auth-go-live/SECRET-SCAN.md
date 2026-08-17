# Escaneo de secretos

## 1. En el árbol del repositorio

`npm run check` corre `scripts/scan-secrets.mjs` como último paso:

```
Secret scan passed: no assigned payment credentials or private keys found.
```

## 2. En el paquete publicado

Ver `PACKAGE-SCAN.md`: 363 archivos, **0 credenciales de servidor**, 1 host, 1
negocio.

## 3. En los artefactos de esta misión

Ninguno de los doce archivos de `artifacts/taba2-production-auth-go-live/`
contiene una credencial. Lo que sí aparece, y es a propósito:

| aparece | qué es |
|---|---|
| `sb_publishable_Du5Gd…S8SK (len=46)` | **huella** de la clave publicable, que además no es secreta: viaja en el navegador |
| `wwcpogltfgzgkrlilbcd` | el ref del proyecto productivo, que es identidad, no secreto |
| `00000000-0000-4000-8000-000000000001` | el uuid del comercio canónico |
| `https://la-taba.pages.dev` | el host público |

## 4. Custodia de credenciales durante la misión

| credencial | cómo se usó |
|---|---|
| token del CLI de Supabase | leído del **Windows Credential Manager** por un envoltorio de PowerShell, puesto en el entorno del proceso hijo y **borrado al terminar**. Nunca impreso, nunca escrito a disco, nunca pasado por línea de comandos |
| clave publicable | escrita a un archivo del directorio temporal de la sesión para pasarla con `--key-file`. No es secreta |
| clave secreta / `service_role` | **no se usó**. Se descartó a propósito un diseño de sonda que la pedía |
| contraseña de la base | **no se usó**: todo el SQL fue por la Management API |
| credenciales de SMTP | **no existen todavía** |

Del token sólo se imprimió, y a propósito, un hecho estructural: `prefijo=sbp_
largo=44`. Alcanza para saber que está y para qué sirve; no alcanza para usarlo.

## 5. Lo que quedó en el directorio temporal, y no en el repo

El directorio de trabajo de la sesión —fuera del repositorio— tiene el
envoltorio del token, las consultas de sólo lectura y la clave publicable. Nada
de eso está versionado ni viaja en ningún artefacto. El único archivo con
apariencia de credencial es el de la clave publicable, que es **pública** por
diseño: viaja en el navegador de cualquiera que abra el sitio.

(El gate de higiene de release no deja escribir una ruta local en un archivo
versionado, y tiene razón: una ruta de máquina en un artefacto no sirve para
nadie más y filtra cómo está armado el entorno de quien lo corrió.)
