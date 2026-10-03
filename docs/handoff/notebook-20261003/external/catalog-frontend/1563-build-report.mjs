// Genera el informe HTML del video (artifact) con stills embebidos.
import fs from 'node:fs';

const F = 'D:/1212/taba-promo-v2/frames';
const b64 = (name) => `data:image/jpeg;base64,${fs.readFileSync(`${F}/${name}.jpg`).toString('base64')}`;
const stills = {
  hook: b64('st-hook'), panel: b64('st-panel'), mapa: b64('st-mapa'),
  codigo: b64('st-codigo'), luna: b64('st-luna'),
};

const html = `<title>Un pedido, de punta a punta</title>
<style>
  :root {
    --bg: #0c0f13; --surface: #161b22; --surface-2: #1d222a;
    --line: rgba(255,255,255,.11); --line-strong: rgba(255,255,255,.22);
    --ink: #f5f5f7; --muted: #a8abb2; --red: #d0000d; --red-ink: #ff5f66;
    --gold: #c9953e; --ok: #58b06d;
    --sans: "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif;
    --mono: Consolas, "Cascadia Mono", ui-monospace, monospace;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: var(--bg); color: var(--ink); font-family: var(--sans); line-height: 1.55; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 48px 22px 80px; }
  header { padding: 26px 0 30px; }
  .brand-line { display: flex; align-items: center; gap: 12px; margin-bottom: 22px; }
  .brand-word { font-style: italic; font-weight: 800; font-size: 20px; letter-spacing: -0.01em; }
  .brand-rule { width: 34px; height: 4px; border-radius: 99px; background: var(--red); }
  h1 { font-size: clamp(30px, 6vw, 44px); font-weight: 800; letter-spacing: -0.02em; line-height: 1.08; text-wrap: balance; }
  .sub { color: var(--muted); margin-top: 14px; max-width: 58ch; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 22px; }
  .chip { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--line); background: var(--surface);
    border-radius: 999px; padding: 6px 14px; font-size: 13px; color: var(--muted); white-space: nowrap; }
  .chip b { color: var(--ink); font-weight: 600; }
  .chip .dot { width: 8px; height: 8px; border-radius: 99px; background: var(--red); }
  section { margin-top: 44px; }
  .eyebrow { font-size: 12.5px; font-weight: 700; letter-spacing: 0.16em; color: var(--red-ink); text-transform: uppercase; margin-bottom: 14px; }
  h2 { font-size: 22px; font-weight: 700; letter-spacing: -0.01em; margin-bottom: 12px; text-wrap: balance; }
  p { color: var(--muted); max-width: 66ch; }
  p + p { margin-top: 10px; }
  strong { color: var(--ink); font-weight: 600; }
  .films { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-top: 18px; }
  .films figure { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: var(--surface); }
  .films img { display: block; width: 100%; height: auto; }
  .films figcaption { font-size: 11.5px; color: var(--muted); padding: 7px 9px; }
  @media (max-width: 620px) { .films { grid-template-columns: repeat(3, 1fr); } .films figure:nth-child(n+4) { display: none; } }
  .cards { display: grid; gap: 12px; margin-top: 16px; }
  .card { border: 1px solid var(--line); background: var(--surface); border-radius: 14px; padding: 18px 20px; }
  .card h3 { font-size: 16.5px; font-weight: 700; margin-bottom: 6px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .card p { font-size: 14.5px; }
  .tag { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; padding: 3px 10px; border-radius: 99px; text-transform: uppercase; }
  .tag.win { background: rgba(208,0,13,.16); color: var(--red-ink); border: 1px solid rgba(255,95,102,.35); }
  .tag.off { background: rgba(255,255,255,.06); color: var(--muted); border: 1px solid var(--line); }
  ol.diag { margin: 16px 0 0 0; padding: 0; list-style: none; counter-reset: d; display: grid; gap: 12px; }
  ol.diag li { counter-increment: d; border-left: 3px solid var(--red); background: var(--surface); border-radius: 0 12px 12px 0;
    padding: 14px 18px; font-size: 14.5px; color: var(--muted); }
  ol.diag li::before { content: counter(d, decimal-leading-zero); font-family: var(--mono); color: var(--red-ink); font-size: 12px; display: block; margin-bottom: 4px; }
  .tbl-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 14px; margin-top: 16px; background: var(--surface); }
  table { border-collapse: collapse; width: 100%; min-width: 620px; font-size: 13.5px; }
  th { text-align: left; font-size: 11.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted);
    padding: 12px 14px; border-bottom: 1px solid var(--line-strong); white-space: nowrap; }
  td { padding: 10px 14px; border-bottom: 1px solid var(--line); vertical-align: top; color: var(--muted); }
  tr:last-child td { border-bottom: none; }
  td:first-child { font-family: var(--mono); font-size: 12px; color: var(--gold); white-space: nowrap; font-variant-numeric: tabular-nums; }
  td b { color: var(--ink); font-weight: 600; }
  .copyblock { display: grid; gap: 8px; margin-top: 16px; }
  .copyline { display: flex; gap: 10px; align-items: baseline; border: 1px solid var(--line); background: var(--surface);
    border-radius: 10px; padding: 10px 14px; font-size: 14px; }
  .copyline .where { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); min-width: 88px; }
  .copyline .q { color: var(--ink); }
  ul.flat { margin: 14px 0 0; padding: 0; list-style: none; display: grid; gap: 10px; }
  ul.flat li { padding-left: 18px; position: relative; font-size: 14.5px; color: var(--muted); }
  ul.flat li::before { content: ""; position: absolute; left: 0; top: 9px; width: 7px; height: 7px; border-radius: 99px; background: var(--gold); }
  code { font-family: var(--mono); font-size: 12.5px; background: rgba(255,255,255,.07); border-radius: 6px; padding: 2px 7px; color: var(--ink); }
  .files { display: grid; gap: 10px; margin-top: 16px; }
  .file { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; border: 1px solid var(--line-strong); background: var(--surface-2);
    border-radius: 12px; padding: 14px 16px; }
  .file .name { font-family: var(--mono); font-size: 13px; color: var(--ink); }
  .file .spec { font-size: 12.5px; color: var(--muted); margin-left: auto; white-space: nowrap; }
  footer { margin-top: 56px; border-top: 1px solid var(--line); padding-top: 18px; font-size: 12.5px; color: var(--muted); }
</style>
<div class="wrap">
  <header>
    <div class="brand-line"><span class="brand-word">La Taba</span><span class="brand-rule"></span><span style="color:var(--muted); font-size:14px;">Luna Systems</span></div>
    <h1>Un pedido, de punta a punta</h1>
    <p class="sub">Video promocional vertical de TABA, construido íntegramente con la aplicación real corriendo en un
    entorno demo controlado. Un único pedido —<strong>LT-0002, Julieta Herrera, 2× Red Bull, $ 9.142</strong>— atraviesa
    las cuatro pantallas del sistema: cliente, panel del negocio, reparto y seguimiento en vivo.</p>
    <div class="meta">
      <span class="chip"><span class="dot"></span><b>33,2 s</b></span>
      <span class="chip"><b>1080×1920</b>&nbsp;9:16</span>
      <span class="chip"><b>30 fps</b>&nbsp;H.264</span>
      <span class="chip">sin audio · listo para Reel, Story y WhatsApp</span>
    </div>
  </header>

  <section>
    <div class="eyebrow">Entregables</div>
    <div class="files">
      <div class="file"><span class="name">promo-video/TABA_PROMO_VERTICAL_1080x1920.mp4</span><span class="spec">33,2 s · 7,4 MB</span></div>
      <div class="file"><span class="name">promo-video/TABA_PROMO_SHORT_1080x1920.mp4</span><span class="spec">15,1 s · 3,7 MB</span></div>
      <div class="file"><span class="name">promo-video/CREATIVO.md</span><span class="spec">diagnóstico · storyboard · guion</span></div>
    </div>
    <p style="margin-top:12px; font-size:13px;">En el worktree <code>C:\\Users\\marco\\dev\\la-taba-business-panel-automation</code> ·
    fuente y material regenerable en <code>D:\\1212\\taba-promo-v2</code>.</p>
    <div class="films">
      <figure><img src="${stills.hook}" alt="Gancho: moto sobre la ruta en el mapa nocturno" width="324" height="576"><figcaption>0:00 · Gancho</figcaption></figure>
      <figure><img src="${stills.panel}" alt="Panel del negocio con LT-0002 entrando" width="324" height="576"><figcaption>0:16 · El panel</figcaption></figure>
      <figure><img src="${stills.mapa}" alt="Seguimiento en vivo sobre el mapa" width="324" height="576"><figcaption>0:22 · En vivo</figcaption></figure>
      <figure><img src="${stills.codigo}" alt="Código de entrega" width="324" height="576"><figcaption>0:26 · Código</figcaption></figure>
      <figure><img src="${stills.luna}" alt="Placa Luna Systems" width="324" height="576"><figcaption>0:31 · Cierre</figcaption></figure>
    </div>
  </section>

  <section>
    <div class="eyebrow">Diagnóstico</div>
    <h2>Por qué el intento anterior no vendía</h2>
    <ol class="diag">
      <li><strong>El producto era una ilustración, no el protagonista.</strong> Imágenes demo, mockups y relleno destruyen
      la única moneda que tiene un video de software: la evidencia de que existe y funciona.</li>
      <li><strong>Lógica de presentación, no de comercial.</strong> Láminas sin interacción visible no prueban nada y no
      dan razón para mirar hasta el final.</li>
      <li><strong>Estética genérica.</strong> TABA ya tiene identidad fuerte (negro/grafito + rojo); cualquier plantilla
      externa la diluye y baja el nivel percibido.</li>
      <li><strong>La causa técnica de fondo:</strong> el catálogo demo bloquea sus fotos por derechos
      (<code>RETAILER_SOLO_REFERENCIA</code>) y muestra placeholders. La salida correcta no era inventar imágenes:
      era espejar el estado publicado real de producción, cuyos packshots de esos mismos SKU ya viven en el repo.</li>
    </ol>
  </section>

  <section>
    <div class="eyebrow">Conceptos</div>
    <h2>Tres caminos, uno elegido</h2>
    <div class="cards">
      <div class="card"><h3>Un pedido, de punta a punta <span class="tag win">Elegido</span></h3>
      <p>Un único pedido real atraviesa el sistema completo y el mismo código, monto y nombre aparecen en las cuatro
      pantallas. La continuidad es la prueba: un mockup no puede fingir un pedido que persiste entre roles.</p></div>
      <div class="card"><h3>Dos pantallas, un negocio <span class="tag off">Descartado</span></h3>
      <p>Montaje alternado cliente/comercio. Empatiza rápido, pero el cambio de contexto cada dos segundos debilita el
      recorrido. Sus etiquetas de punto de vista sobrevivieron en el elegido.</p></div>
      <div class="card"><h3>Esto no es una plantilla <span class="tag off">Descartado</span></h3>
      <p>Manifiesto tipográfico sobre montaje rápido. Máximo estilo, mínima prueba de proceso: el riesgo exacto que
      había que evitar. Su energía tipográfica quedó en el gancho y el cierre.</p></div>
    </div>
  </section>

  <section>
    <div class="eyebrow">Storyboard · corte final</div>
    <h2>33 segundos, cinco capítulos</h2>
    <div class="tbl-wrap"><table>
      <tr><th>Tiempo</th><th>Pantalla real</th><th>Texto sobreimpreso</th></tr>
      <tr><td>0:00–0:03</td><td><b>Gancho:</b> moto en ruta sobre el mapa nocturno → góndola → pedido entrando al panel</td><td>«¿Y si tu comercio tuviera esto?» · «Su propio sistema de pedidos y delivery.»</td></tr>
      <tr><td>0:03–0:12</td><td><b>Lo que ve tu cliente:</b> home → góndola con packshots reales → ficha Red Bull → cantidad ×2 → carrito con mínimo alcanzado → «Tu pedido fue confirmado» + toast</td><td>«Tu catálogo, con tu marca» · «Pedido en segundos» · «Confirmado. Sin llamadas, sin planillas.»</td></tr>
      <tr><td>0:12–0:19</td><td><b>Lo que ve tu negocio:</b> bandeja con cola en curso → <b>LT-0002 entra solo</b> con toast y contador → «Aceptar pedido» → pasa a EN PREPARACIÓN</td><td>«El negocio tiene su panel» · «El pedido entra solo, con timbre» · «Estados claros. Cola bajo control.»</td></tr>
      <tr><td>0:19–0:20</td><td><b>El reparto:</b> «Entrega disponible · LT-0002» → aceptar → datos del cliente revelados → salir a repartir</td><td>«El reparto, coordinado»</td></tr>
      <tr><td>0:20–0:27</td><td><b>En vivo:</b> mapa nocturno de Neuquén, ruta roja por calles reales, la moto recorre con ETA que baja → llegada → <b>código de entrega</b> de 4 dígitos</td><td>«Seguimiento en vivo sobre el mapa» · «Entrega con código de seguridad» · Mapa © OpenStreetMap</td></tr>
      <tr><td>0:27–0:33</td><td><b>Cierre:</b> placa TABA (logotipo real) → placa Luna Systems con CTA</td><td>«Esto es TABA. Una plataforma real, funcionando hoy.» · «Una muestra de lo que podemos construir para tu negocio.» · «Software a medida» · «Contanos qué necesita tu negocio» · WhatsApp 299 620 9136</td></tr>
    </table></div>
    <p style="margin-top:12px; font-size:13.5px;">Versión corta (15,1 s): gancho → góndola + ficha → confirmado → pedido
    entra al panel + aceptar → moto en vivo + código → placa Luna Systems.</p>
  </section>

  <section>
    <div class="eyebrow">Honestidad de producción</div>
    <h2>Qué es real y qué es demo</h2>
    <ul class="flat">
      <li><strong>Todo lo que se ve es la aplicación real</strong> de la rama <code>feature/taba-business-panel-automation</code>
      (<code>523d3d0</code>), corriendo local en modo demo y en el panel operativo con el mismo arnés de fixtures que usan
      las suites E2E del repo.</li>
      <li><strong>Datos de prueba:</strong> «Julieta Herrera», Avenida Argentina 450, pedidos LT-00xx. Ninguna persona real.</li>
      <li><strong>Fotos de producto:</strong> se espejó en la demo el estado publicado de producción (los packshots reales
      de esos SKU ya están commiteados en <code>assets/catalog/beverages/</code>); override de runtime sólo en el navegador
      de grabación, el repo no se tocó.</li>
      <li><strong>No se muestra:</strong> Mercado Pago, consolas, credenciales, alcohol como protagonista, pantallas inventadas.</li>
      <li><strong>Recorrido del mapa:</strong> la simulación guiada propia del producto — ruta real por calles de Neuquén,
      etiquetada por la app como «Recorrido de muestra».</li>
    </ul>
  </section>

  <section>
    <div class="eyebrow">Hallazgos</div>
    <h2>Lo que la producción destapó (backlog)</h2>
    <ul class="flat">
      <li>En demo a 432 px con perfil sembrado hay un <strong>vacío negro de miles de píxeles</strong> entre el resumen del
      carrito y el botón «Confirmar pedido». Un cliente que scrollea lo ve.</li>
      <li>Existe un botón <strong>«Confirmar pedido» duplicado y oculto</strong> en el DOM.</li>
      <li>La vista del repartidor queda <strong>en blanco un instante</strong> tras «Aceptar entrega» y tras «Marcar en camino».</li>
      <li>El dataset demo <strong>bloquea todas sus fotos por derechos</strong> aunque producción ya publica packshots reales
      de esos mismos SKU: merece un refresh de <code>rightsStatus</code>.</li>
    </ul>
  </section>

  <section>
    <div class="eyebrow">Regeneración</div>
    <h2>El video se puede volver a cortar sin regrabar</h2>
    <p>Los cuadros físicos 1080×1920 quedaron en <code>D:\\1212\\taba-promo-v2\\takes\\</code> con timestamp por cuadro.
    Cambiar un texto, un tiempo o una velocidad es editar <code>scripts/build-edit.mjs</code> (o
    <code>gen-overlays.mjs</code> para las placas) y volver a correr — dos minutos, sin tocar la aplicación.
    Para regrabar desde cero: <code>node scripts/realtime-relay.mjs 8093</code> en el worktree y
    <code>node scripts/record-takes.mjs</code>.</p>
  </section>

  <footer>Producido el 28/08/2026 sobre el proyecto validado <code>la-taba-pages-preview</code> · rama
  <code>feature/taba-business-panel-automation</code> @ <code>523d3d0</code> · Mapa © OpenStreetMap.</footer>
</div>
`;

fs.writeFileSync('D:/1212/taba-promo-v2/out/informe-taba-promo.html', html);
console.log('informe:', (html.length / 1024).toFixed(0), 'KB');
