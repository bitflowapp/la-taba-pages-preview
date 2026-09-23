# Piloto Rider — evidencia del 23/09/2026

La fuente histórica v146 sigue sin recuperarse. La APK estable instalada es
`com.lataba.rider` 1.0.0 (146). La implementación nueva conserva su identidad
QA y añade `com.lataba.rider.pilot` 0.1.0-canonical-pilot como paquete separado.

## Lo que pasó

- Supabase Staging `ucbtjcurawxjwjdvvcvj` recibió la migración
  `20260923071557_pilot_rider_shared_availability`. La política empieza
  desactivada por comercio: una APK antigua conserva su contrato hasta que el
  negocio habilite el cambio. Sólo el negocio QA la activó por RPC autorizada.
- Riders A/B y un segundo dispositivo lógico confirmaron disponibilidad
  compartida, actualización del panel, versionado, no-op idempotente,
  logout/login y denegación de acceso anónimo o a otro negocio. Capacidad máxima
  siguió siendo 3. Reportes: `artifacts/rider-presence-*.json`.
- La APK piloto nueva fue firmada, verificada e instalada en Moto G15. La
  huella SHA-256 del certificado es
  `2D:CC:9B:0A:0C:F0:22:EB:F5:9C:50:03:31:10:3E:E3:1C:EC:9E:91:42:D5:43:15:53:13:18:77:94:8E:C1:AA`.
  Clave y contraseña fuera del repo; copia PKCS12 protegida por Credential
  Manager. Falta copia externa independiente de esta computadora.
- Un pedido QA fue aceptado e iniciado desde Android con GPS real. Panel y
  cliente web lo vieron asignado, en camino y con marcador de Rider.
- Soak de 60 minutos: **FAIL**. Hubo 53 recibos GPS al comienzo y luego el Moto
  perdió la ruta de Internet. La prueba del dispositivo registró 52 minutos
  offline; la medición de consola confirmó ausencia de ruta IPv4/IPv6 incluso
  para una IP pública. La reconexión Wi-Fi/datos por ADB restauró los
  interruptores originales, pero no un enlace de red. Crashes: 0; ANR: 0;
  batería 100→100 mientras cargaba, por lo que el delta no certifica consumo.
  Las órdenes del backend no se forzaron por SQL.
- El pedido del soak se canceló por la RPC del negocio y se clasificó QA. Tras
  `picked_up`, el backend no repuso stock automáticamente: correcto si la
  mercadería quedó en manos del Rider. En este QA no salió mercadería física;
  un movimiento de inventario auditado con la misma llave en un reintento
  devolvió **38→42 unidades exactamente una vez**. El servicio GPS QA se detuvo.

## Estado de salida

```text
RIDER_SOURCE_RECOVERED: NO
RIDER_REPLACEMENT_FOUNDATION: READY
ANDROID_PILOT_BUILD: PASS_SIGNED_STAGING_ONLY
RIDER_AVAILABILITY_SHARED: PASS_STAGING
RIDER_CAPACITY: 3
ANDROID_SHORT_E2E: PASS
GPS_60_MIN_SOAK: FAIL_DEVICE_NO_NETWORK_ROUTE
PILOT_RIDER_READY: NO
PRODUCTION_UNCHANGED: YES
WALTER_ACCOUNT_UNCHANGED: YES
```

El siguiente ensayo físico necesita que el Moto vuelva a tener Internet de
forma estable; repetirlo con la misma red caída no aportaría evidencia nueva.
La fuente, la firma y el identificador de paquete de v146 nunca se usaron para
construir ni firmar `.pilot`.
