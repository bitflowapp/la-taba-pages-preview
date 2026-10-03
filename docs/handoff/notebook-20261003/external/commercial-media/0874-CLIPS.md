# clips/ — montaje del video

Los clips están numerados en orden de aparición y ya vienen recortados, ajustados
de ritmo y codificados igual (H.264, 1920×1080, 30 fps, sin audio). Para rearmar el
video basta pegarlos en orden; para cambiar el montaje, reemplazá o sacá el clip que
quieras y volvé a correr `node _work/build.mjs`.

| # | Clip | Entra | Dura | Qué muestra |
| --- | --- | --- | --- | --- |
| 1 | `00-apertura.mp4` | 00:00 | 10.1 s | Apertura |
| 2 | `01-cliente.mp4` | 00:10 | 49.4 s | Escena 1 · El cliente compra |
| 3 | `02-prueba-mercado-pago.mp4` | 00:59 | 18.4 s | La prueba · Mercado Pago en modo TEST |
| 4 | `03-negocio.mp4` | 01:17 | 22.8 s | Escena 2 · El negocio recibe |
| 5 | `04-reparto.mp4` | 01:40 | 29.5 s | Escena 3 · El reparto |
| 6 | `05-seguimiento.mp4` | 02:10 | 17.2 s | Escena 4 · El cliente sigue su pedido |
| 7 | `06-operacion.mp4` | 02:27 | 36.0 s | Escena 5 · Qué pasa en el negocio |
| 8 | `07-ventas-y-stock.mp4` | 03:03 | 21.0 s | Escena 5 · Ventas, ticket y stock |
| 9 | `08-facturacion.mp4` | 03:24 | 39.9 s | Escena 6 · La facturación (sintético) |
| 10 | `09-whatsapp.mp4` | 04:04 | 23.0 s | Escena 7 · El mismo sistema por WhatsApp |
| 11 | `10-cierre.mp4` | 04:27 | 24.8 s | Cierre |

**Duración total:** 04:52 (292.2 s)

## Cómo se rearma

```bash
# la lista, en orden
printf "file '%s'\n" clips/*.mp4 > lista.txt
ffmpeg -f concat -safe 0 -i lista.txt -c copy TABA2-WALTER-DEMO.mp4
```

## Cómo se le pone una voz encima

La narración está en `VIDEO-SCRIPT.md` con sus tiempos, y en `TABA2-WALTER-DEMO.srt`.
Si Marco graba su voz (`voz.wav`), se monta así:

```bash
ffmpeg -i TABA2-WALTER-DEMO-sin-musica.mp4 -i voz.wav \
  -c:v copy -c:a aac -b:a 192k -shortest TABA2-WALTER-DEMO-con-voz.mp4
```

Conviene grabar sobre `-sin-musica.mp4`: la cama sonora del master está a −28 dB y
compite con una voz cercana.