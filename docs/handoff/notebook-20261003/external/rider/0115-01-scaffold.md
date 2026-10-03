# Prompt Codex — Etapa 1: scaffold

Implementá sólo el scaffold de `C:\1212\la-taba-rider-android` para la app LA TABA RIDER ANDROID.

Leé primero `C:\1212\artifacts\la-taba-rider-architecture\PROJECT_TREE.md`, `ARCHITECTURE.md` y los ADRs 0001/0008/0009. Creá Flutter con `staging` y `production`, package/applicationId separados y la estructura indicada en `lib/core`, `lib/features/auth`, `lib/features/orders`, `lib/features/delivery`, `lib/features/map` y Kotlin nativo.

Restricciones: no tocar `C:\1212\la-taba-real-orders-staging`; no modificar Supabase; no agregar RPCs; no usar WebView ni AccessibilityService; no agregar service_role ni secretos; no implementar lógica funcional completa aún.

Pruebas: `flutter analyze`, `flutter test`, build debug de ambos flavors y una prueba que falle cerrado si production recibe una URL staging.

Aceptación: la app abre una pantalla de placeholder por flavor, compila, el árbol coincide con el documento, la configuración es explícita y el diff sólo contiene el proyecto Android y sus tests.

