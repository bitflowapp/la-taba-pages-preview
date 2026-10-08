# Safari en iPhone físico

IPHONE_REAL: NOT_RUN. WebKit emulado no certifica hardware, touch del sistema ni el ciclo de vida de Safari.

Servir este candidato en la LAN con `node scripts/realtime-relay.mjs 18265` y abrir la dirección de la PC desde Safari. Usar sólo demo/fixtures; no confirmar pedidos ni pagos reales.

1. En 390/430 px, recorrer catálogo, categorías y carrito. Arrastrar categorías: sin clicks fantasma; comprobar selección, spring y scroll vertical.
2. Abrir tracking En camino con datos locales. Pan horizontal con un dedo y pinch; un gesto vertical debe permitir llegar a los detalles.
3. Después del pan, verificar que el mapa conserva el encuadre aunque cambie el GPS. Tocar Seguir repartidor para retomar follow.
4. Bloquear/desbloquear el teléfono y volver a Safari. El casco debe converger a la posición actual sin replay ni recreación del canvas.
5. Activar Reducir movimiento: sin loops ni efecto magnético persistente. Comprobar texto del estado y foco accesible.
6. Con una PWA anterior instalada, verificar el aviso de actualización, actualización explícita y apertura offline con las dos capas premium.

Anotar dispositivo/iOS/Safari, resultado y captura/video. No registrar números de serie ni identificadores privados.
