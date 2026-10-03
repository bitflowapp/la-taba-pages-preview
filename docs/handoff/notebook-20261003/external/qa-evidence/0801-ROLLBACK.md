# ROLLBACK — TABA2-PILOT-RC2-CANDIDATE.1

Deriva de §11 del `TABA2_MASTER_RELEASE_PLAN.md`. Este documento distingue con
rigor **lo preparado y verificado en esta sesión** de **lo que sigue sin ensayar**.

> **Estado de G6R: NO EJECUTADO.**
> El plan es explícito (§9, G7): *«Rollback G6R ya ejecutado, no sólo documentado»*.
> Nada de lo que sigue reemplaza esa ejecución.

---

## 1. Qué SÍ quedó preparado y verificado

### 1.1 Recuperación del código (lo único realmente ensayado)

| Artefacto | Verificación |
| --- | --- |
| `TABA2-AUDIT-20260808-WEB-BASE` → `3d69e6b…` | tag local creado |
| `TABA2-AUDIT-20260808-WEB-OPS` → `03c2fbdf…` | tag local creado |
| `TABA2-AUDIT-20260808-RIDER-BASE` → `7cec5a7…` | tag local creado |
| `rider-all-20260808.bundle` | `git bundle verify` ✅ *records a complete history* |
| `web-rc2-sources-20260808.bundle` | `git bundle verify` ✅ *records a complete history* |

Volver al estado previo al candidato es, hoy, un `git checkout` a `3d69e6b`
(web) y `7cec5a7` (Rider). **Las ramas fuente no fueron movidas**: se verificó
después de crear los worktrees que siguen exactamente en su SHA original.

### 1.2 Restore de base de datos (ensayado, pero NO contra staging)

`npm run pilot:ops:drill` sobre clústeres PostgreSQL locales y descartables:

- 63 migraciones reconstruidas desde cero en un **segundo clúster** —el escenario
  real de recuperación: proyecto nuevo, esquema desde migraciones, datos desde el
  backup—.
- **69 tablas con contenido idéntico** tras el restore.
- **72 comprobaciones de contrato operativo**, ejecutadas antes del backup y otra
  vez sobre el proyecto recuperado.
- Restauración en 328 ms.

Esto demuestra que **el esquema del candidato se puede reconstruir y repoblar**.
No demuestra nada sobre el proyecto hospedado.

### 1.3 APK candidato archivado

§11.1 del plan pide *«Archivar también el APK candidato original y ensayar el regreso
en el Moto»*. La primera mitad está hecha:

| Artefacto | SHA-256 |
| --- | --- |
| `app-staging-debug.apk` | `3cb61d528da62edd8b3c00b91186681162836cb6666f575cae6424c5bcd3fda8` |
| `app-staging-debug-androidTest.apk` | `84a7d660f07342f714af7ab4490c256d14cd076646b9a58dbead2da15fc00011` |

Guardadas en `artifacts-rider/` con su identidad y firma en `APK-MANIFEST.md`. Sirven
para el regreso al candidato: desinstalar el rollback e instalar **estos mismos bits**,
sin recompilar ni elevar `versionCode`.

**La segunda mitad no está hecha:** no se ensayó el regreso en el Moto, ni siquiera se
instaló el APK.

### 1.4 Compatibilidad forward-only

La migración nueva `20260807155000` es forward-only y no destructiva:
- en base limpia crea;
- donde ya existe, es **no-op** —no reemplaza funciones—;
- ante estado parcial, **aborta con excepción antes de mutar**.

No hay down-migration. El camino de vuelta es aplicación + migración compensatoria,
nunca `drop`.

---

## 2. Qué NO está listo — y por qué

| Requisito de G6R | Estado | Motivo |
| --- | --- | --- |
| Clon/entorno sacrificable con esquema y artefactos del candidato | ❌ | Clonar staging copia filas reales de personas. **Bloqueado por P0.14/P0.15**, que son actas de autorización/consentimiento y un plan de datos aprobado. |
| Pausa de admisión verificada (bloquea checkouts nuevos sin cortar callbacks) | ❌ | El plan exige **probarlo, no asumirlo**. Requiere ventana exclusiva de staging. |
| Repoint del alias web y rollback de Edge al artefacto anterior | ❌ | Requiere desplegar. No se desplegó nada. |
| Pago TEST aprobado y pendiente que reconcilie durante el rollback sin duplicarse | ❌ | Requiere staging vivo y Mercado Pago TEST. |
| APK de rollback desde el source anterior, misma firma, `versionCode` superior | ❌ | No construida. Es un **artefacto nuevo** que debe pasar G4 y el smoke crítico de G5 antes del piloto. |
| Regreso al candidato en el Moto único (desinstalar rollback + instalación limpia del APK candidato archivado) | ❌ | No ejecutado. |
| Acta con tiempos, hashes y órdenes | ❌ | No hay corrida que actar. |

### Backups del proyecto hospedado (P0.6)

**Sin auditar.** No se confirmó si `la-taba-staging` tiene backups habilitados, con
qué frecuencia, retención, PITR, último éxito ni quién está autorizado a restaurar.
El drill local es valioso pero, como advierte C8 del plan, **no prueba nada sobre
Supabase hospedado**. Las cinco preguntas están listadas en `OPERATIONS-RUNBOOK.md`
del candidato y deben responderse en la consola del proveedor.

---

## 3. Disparadores de rollback inmediato

Sin cambios respecto de §11.2 del plan. Cualquiera de estos corta el piloto:

- Dos pedidos para una misma intención de compra.
- Pago aprobado sin pedido, o monto inconsistente.
- Pérdida o duplicación de stock o de reserva.
- Acceso anónimo o no autorizado a cola, coordenadas o datos fiscales.
- Panel sin intake o sin transiciones.
- El Rider pierde una entrega activa.
- Migración parcial o historial incoherente.
- Alertas o telemetría ciegas.
- Error sostenido que impide completar el único flujo del piloto.

---

## 4. Secuencia (§11.3, sin ejecutar)

1. **Cerrar admisión** — pausar el negocio o publicar mantenimiento, verificando
   que no nazcan checkouts nuevos.
2. **No cortar callbacks** — webhook, status y reconciliación siguen vivos para los
   pagos ya iniciados.
3. **Preservar evidencia** — snapshot de órdenes, pagos, stock, reservas, outboxes,
   eventos, logs y correlation IDs.
4. **Web** — repuntar el alias al deployment inmutable previo.
5. **Edge** — redesplegar los artefactos anteriores si el incidente está ahí.
   Hashes actuales capturados en `SOURCE-MATRIX.md` §6.
6. **Rider** — instalar el APK de rollback ya preparado. **No improvisar un
   downgrade**: Android bloquea instalar sobre un `versionCode` mayor.
7. **DB** — no borrar ni bajar migraciones. Desactivar la superficie nueva por
   flag/config y, si hace falta, aplicar una migración compensatoria forward-only.
8. **Reconciliar** — pagos aprobados, pedidos, stock y outboxes antes de reabrir.
9. **Validar** — smoke mínimo sobre la versión restaurada.
10. **Comunicar** — incidente, impacto, decisiones y siguiente RC.

Restaurar un backup encima de staging es **último recurso**: puede borrar pedidos o
callbacks posteriores al backup.

`scripts/primer-pedido-humano/rollback.mjs` es una herramienta diagnóstica con
supuestos propios; **no constituye un rollback genérico certificado**.

---

## 5. Rollback de lo que esta sesión sí hizo

Todo lo que se creó es aditivo y local. Para deshacerlo por completo:

```powershell
# 1. Quitar los worktrees del candidato
git -C C:\Users\marco\dev\la-taba-pages-preview worktree remove D:\1212\worktrees\taba2-pilot-rc2-web
git -C D:\1212\la-taba-rider-android          worktree remove D:\1212\worktrees\taba2-rider-pilot-rc2

# 2. Borrar las ramas creadas (no tienen upstream; nada que revertir remotamente)
git -C C:\Users\marco\dev\la-taba-pages-preview branch -D release/taba2-pilot-rc2
git -C D:\1212\la-taba-rider-android          branch -D release/taba2-rider-pilot-rc2

# 3. Borrar los tags de auditoría (opcional; son sólo marcadores locales)
git -C C:\Users\marco\dev\la-taba-pages-preview tag -d TABA2-AUDIT-20260808-WEB-BASE TABA2-AUDIT-20260808-WEB-OPS
git -C D:\1212\la-taba-rider-android          tag -d TABA2-AUDIT-20260808-RIDER-BASE
```

No hay nada que revertir en staging, producción, Cloudflare, Mercado Pago, ARCA ni
en el teléfono: **esta sesión no los tocó**.
