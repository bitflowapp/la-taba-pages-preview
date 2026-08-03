# TABA Negocio para Windows

## Arquitectura

La aplicación de escritorio es un shell Tauri 2 de usuario actual. El WebView muestra el panel operativo; Supabase Auth identifica a owner, admin o staff; PostgreSQL conserva la autoridad de pedidos, catálogo, stock, packing, ventas y estados fiscales. Realtime acelera la interfaz, pero cada reconexión vuelve a leer snapshots autoritativos.

Los comandos de pedido pasan primero por una outbox durable local. En Windows se usa SQLite con WAL; en navegador de contingencia se usa IndexedDB. Antes de enviar o reintentar se reconcilia la revisión del servidor. Los estados `pending`, `sending`, `confirmed`, `conflicted` y `failed` impiden presentar un éxito no confirmado.

El panel nunca se conecta a ARCA. Sólo solicita un documento por RPC autenticada; PostgreSQL crea `fiscal_outbox` y un worker privado usa WSAA/WSFEv1. Certificados, clave privada, ticket, `token`, `sign` y service role no entran al cliente.

## Instalación y build

Requisitos de desarrollo: Windows 10/11, WebView2, Node.js 22 o posterior, npm, Rust MSVC 1.77.2 o posterior y las herramientas de compilación C++ de Microsoft.

```powershell
npm ci
npm run fiscal:install
npm run check
npm test
npm run fiscal:test
npm run test:e2e
npm run tauri:build
```

Los instaladores se generan fuera del control de versiones bajo el `target` de Cargo: `bundle/msi` y `bundle/nsis`. El MSI sirve para despliegue administrado y el instalador NSIS es por usuario actual. La desinstalación se realiza desde Aplicaciones instaladas de Windows. Desinstalar no debe usarse como mecanismo para descartar comandos pendientes.

## Configuración y operación

La configuración pública sólo admite una URL HTTPS de Supabase, publishable key, `businessId` y ambiente de despliegue. Una key con rol privilegiado se rechaza. La sesión de equipo se abre mediante Supabase Auth y una membresía activa del comercio.

El cierre de la ventana la oculta y conserva la aplicación en tray. Desde el tray se puede abrir, silenciar/activar alertas y salir realmente. Una segunda instancia enfoca la primera. El inicio automático se cambia mediante el comando nativo y no mediante el registro desde JavaScript.

`initialize_business_runtime` devuelve las rutas resueltas por el sistema. La base se llama `taba-negocio.sqlite3` dentro del directorio de datos de la aplicación `ar.com.lataba.negocio`; los logs rotados se llaman `taba-negocio` dentro del directorio de logs. No asumir una ruta absoluta: registrarla desde esa respuesta para soporte.

## Recuperación

1. Si no hay red, conservar la aplicación abierta o cerrarla normalmente. Los comandos quedan pendientes; no se afirma éxito.
2. Al recuperar red, abrir el panel y comprobar “Última reconciliación”, pendientes y conflictos.
3. Un conflicto de revisión requiere recargar el pedido y decidir con su snapshot nuevo; no se reenvía a ciegas.
4. Si SQLite no abre, copiar el archivo y sus archivos WAL/SHM con la aplicación cerrada antes de intervenir. No borrarlos si existen pendientes.
5. Si Realtime falla, la bandeja conserva lo último conocido y vuelve a consultar PostgreSQL.
6. Una impresora desconectada no cambia venta, stock ni estado fiscal; corregir la cola de Windows y reimprimir.

## Pruebas y diagnóstico

- `npm run check`: sintaxis, assets e higiene de release.
- `npm test`: dominios, repositorios, seguridad y contratos de migración.
- `npm run fiscal:test`: WSAA, WSFEv1, reconciliación, QR y PDF sin red real.
- `npm run test:db:local`: pgTAP sobre Supabase local ya iniciado.
- `npm run test:e2e`: interfaz real y flujos operativos.
- `cargo test`, `cargo clippy -- -D warnings`: SQLite, comandos Tauri e impresión nativa.

Para soporte, capturar versión, estado de conexión, número de pendientes y códigos sanitizados. No copiar JWT, service role, contenido PEM, datos completos de receptores ni códigos de entrega.

## Comprobantes fiscales

El circuito de PDF privado, hash, URL efímera, spool local durable, reimpresión y recuperación está documentado en [Comprobantes fiscales persistidos en Windows](fiscal-artifacts-and-printing.md).

## Rollback

El binario puede volver a un instalador anterior firmado y conservado por operaciones. Las migraciones PostgreSQL no se revierten borrando tablas: se prepara una migración correctiva incremental, se prueba localmente y se aplica con aprobación separada. Antes de cambiar versión, permitir la reconciliación o respaldar SQLite. Producción y staging requieren confirmación explícita independiente.
