# Matriz de reproducción y cobertura

| Escenario | Antes | Cobertura posterior |
| --- | --- | --- |
| Sesión limpia | main vacío si el módulo no terminaba de arrancar | E2E: primer render y catálogo de 14 productos |
| Estado viejo o `products=[]` | podía conservar una pantalla sin productos | E2E: catálogo base reconstruido |
| `?reset=1&demo=1` | reset antes de pintar y riesgo de espera | E2E: pinta, elimina query y no entra en loop |
| IndexedDB rechazado | sync sin garantía de respuesta | E2E: interfaz usable en memoria |
| IndexedDB demorado | primera experiencia dependía del request | E2E existente: customer surface antes de hydration |
| `app.js` fallando | header/nav sin recuperación | E2E: panel estático con reintento/reinicio |
| Service worker viejo | dependía de actualización posterior | SW versionado, `updateViaCache: none`, precache del rescate |
| Producción sin `demo=1` | riesgo a vigilar | E2E: gate visible y repositorio no sandbox |

Las pruebas usan Chromium/Playwright para reproducir fallos de almacenamiento y red. La comprobación física en Safari iPhone queda registrada separadamente según disponibilidad del dispositivo.
