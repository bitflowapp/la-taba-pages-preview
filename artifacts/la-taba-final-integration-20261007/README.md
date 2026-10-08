# La Taba · integración final · 07/10/2026

Rama: `release/la-taba-premium-tracking-final-20261007`.
Base verificada: `cd26834b25909a3fbf6b5133af7b70c39a35fc2d`.

Se integró #142 y luego #144, que contiene #143. Los tres heads originales son ancestros del candidato; no se repitió el merge de #143. [Audit de origen](source-audit.json): producción y main coinciden, incluidos los hashes reales de CSS y service worker. No se modificaron backend, pagos, repositorios de datos, configuración runtime ni migraciones.

CSS v77 conserva `premium-storefront.css` y `tracking-premium.css`. La identidad firmada común es `la-taba-runtime-v148-premium-tracking-final`, con 214 assets; se precachean categoría glass, textura, touch intent y ambas capas CSS.

Los resultados completos se generan **localmente en este directorio** y se conservan fuera del árbol versionado: capturas, videos, logs, métricas, actualización PWA y `TECHNICAL_REPORT.md`. La historia Git conserva la evidencia de los PR originales; este árbol de release evita copiar otra vez sus binarios. GitHub Actions publica además la matriz de features y trazas.

## Reproducir

```powershell
npm ci --no-audit --no-fund
npm run check
npm test
npx playwright test
npx playwright test --config playwright.final-integration.config.mjs
```

La configuración final ejercita Liquid Glass y tracking juntos en Android Chromium, iPhone WebKit emulado y escritorio en ambos motores. El workflow `Validate release candidate` ejecuta tanto el gate general como esta matriz.

Para comparar contra la base, preparar un checkout de ese SHA en el directorio hermano `la-taba-final-baseline-20261007`. Servir baseline en 18266 y candidato en 18265 con `node scripts/realtime-relay.mjs PORT`. Ejecutar las mediciones **sin otras suites de navegador activas**:

```powershell
node scripts/qa-final-integration-captures.mjs before
node scripts/qa-final-integration-captures.mjs final
node scripts/qa-final-motion.mjs
node scripts/qa-final-performance.mjs
node scripts/qa-final-pwa-update.mjs
node scripts/qa-final-sanitize.mjs
```

Capturas finales: 390×844, 430×932, 1366×768, 1440×900 y 1920×1080; home, catálogo, categorías, carrito, checkout y cinco estados de seguimiento. Datos de catálogo congelados y backend/GPS de fixture: no se crean pedidos ni pagos reales. La preservación de WebGL para screenshots sólo se habilita en el script de captura.

La prueba PWA usa un servidor local que sirve primero el árbol de producción v144 y después el candidato v148. Verifica espera de actualización, activación explícita, eliminación de caché anterior, los 214 assets y arranque offline en ambos motores.

## Expiración

La fixture anterior suponía una sola consulta antes de la carga completa. `pageshow` puede revalidar legítimamente después de resolver la primera RPC. Además, una carga fría lenta podía consumir la ventana ficticia de 30 segundos. Se sincroniza la frontera de navegación, se inicia el reloj antes de la ventana y se pausa al comienzo del escenario. Se mantienen los controles de token, limpieza, ausencia de fallback a otro pedido, una sola consulta adicional por burst y ausencia de consultas posteriores. No cambia el código productivo de polling/expiry. La comparación original y determinista contra main se conserva en los logs locales.

## Límites

WebKit emulado no equivale a Safari físico. [Checklist de iPhone](IPHONE-REAL.md): `IPHONE_REAL: NOT_RUN`. Las métricas rAF/heap son observaciones acotadas; no certifican 60 FPS constantes ni ausencia universal de leaks.

La certificación final se registra en `TECHNICAL_REPORT.md` local y en el cuerpo del PR, una vez concluidas las verificaciones y CI. No se hace merge, deploy ni cierre de #142/#143/#144 durante esta tarea.
