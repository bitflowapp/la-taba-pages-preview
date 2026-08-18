/*
 * LA INVITACIÓN A INSTALAR, EN UN NAVEGADOR DE VERDAD.
 *
 * `tests/pwa-install.test.mjs` prueba la decisión con objetos falsos. Acá se
 * prueba lo que sólo se rompe con el DOM puesto: que la hoja se abra sola en la
 * primera visita móvil, que el prompt nativo se llame UNA vez y desde el gesto,
 * que la decisión sobreviva a una recarga y que en escritorio no aparezca nada.
 *
 * Sobre el `beforeinstallprompt` sintético: Chromium no lo dispara en un
 * servidor de prueba —hacen falta criterios de "engagement" que ningún gate
 * puede reproducir—, así que se dispara a mano un evento con la MISMA forma
 * (`preventDefault`, `prompt()`, `userChoice`). Lo que se está midiendo es el
 * comportamiento de la tienda frente a ese evento, no que Chrome lo emita.
 *
 * Y NO se usa `installBrowserStubs`: ese helper limpia el almacenamiento en
 * cada navegación, que es exactamente lo contrario de lo que hay que medir acá.
 * Cada test recibe un contexto nuevo, así que el almacenamiento ya empieza vacío.
 */
import { expect, test } from '@playwright/test';

/*
 * La PRIMERA navegación de una corrida paga el grafo frío: ~100 módulos que el
 * servidor de prueba lee por primera vez y que el motor compila sin caché.
 * Medido en esta máquina: 50 s la primera, 1-8 s todas las demás. Corrido dentro
 * del gate completo el costo lo paga otro archivo; corrido solo lo paga éste, y
 * un rojo por arranque frío no es un defecto. Por eso el presupuesto se declara
 * en vez de dejarlo intermitente.
 */
test.describe.configure({ timeout: 90_000 });

/*
 * El único archivo que arranca SIN la decisión sembrada.
 *
 * `playwright.config.mjs` le pone a todo el gate un `TABA_INSTALL_PROMPT_V1`
 * con "declined", para que la invitación no le robe toques a suites que miden
 * otra cosa. Acá la invitación ES lo que se mide, así que el estado se vacía y
 * cada test empieza como una primera visita de verdad.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const PHONE = { width: 390, height: 844 };
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15; moto g15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
// Chrome para iOS: mismo motor que Safari, pero el Compartir vive en SU menú.
const IOS_CHROME_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.0.0 Mobile/15E148 Safari/604.1';
// El navegador embebido de Instagram: no tiene "Agregar a pantalla de inicio".
const IOS_WEBVIEW_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.26.111 (iPhone14,3; iOS 17_4; es_AR)';
const DECISION_KEY = 'TABA_INSTALL_PROMPT_V1';

const sheet = (page) => page.locator('[data-install-sheet]');
const view = (page, name) => page.locator(`[data-install-view="${name}"]`);
const entry = (page) => page.locator('[data-install-entry]');

/** El evento que Chrome dispararía. Se arma a mano y se dispara cuando el test quiere. */
async function armInstallPrompt(page) {
  await page.addInitScript(() => {
    window.__install = { prompts: 0, outcome: 'accepted' };
    window.__fireBeforeInstallPrompt = () => {
      const event = new Event('beforeinstallprompt');
      event.prompt = async () => {
        window.__install.prompts += 1;
        return { outcome: window.__install.outcome, platform: 'web' };
      };
      event.userChoice = Promise.resolve({ outcome: window.__install.outcome });
      window.dispatchEvent(event);
    };
  });
}

/** Abrir la app instalada: `display-mode: standalone` para Android/escritorio. */
async function pretendStandalone(page) {
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      if (!String(query).includes('display-mode')) return real(query);
      return {
        matches: String(query).includes('standalone'),
        media: String(query),
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() { return false; },
      };
    };
  });
}

/** Abrir la app instalada en iOS: la propiedad propia de Safari. */
async function pretendIOSStandalone(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
  });
}

async function seedDecision(page, decision) {
  await page.addInitScript(([key, value]) => {
    localStorage.setItem(key, JSON.stringify({ v: 1, decision: value, at: '2026-08-18T00:00:00.000Z', platform: 'android' }));
  }, [DECISION_KEY, decision]);
}

async function abrir(page, target = '/?demo=1') {
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached' });
}

/** La decisión tal cual quedó guardada. */
const storedDecision = (page) => page.evaluate((key) => {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw).decision : null;
}, DECISION_KEY);

/*
 * Cuánto se espera para afirmar que NO apareció nada. La invitación se programa
 * a 2.500 ms del arranque; con margen para el reintento por cambio de vista,
 * 4 segundos alcanzan y sobran para que un fallo se vea.
 */
const VENTANA_SIN_INVITACION = 4000;

test.describe('Android', () => {
  test.use({ userAgent: ANDROID_UA, viewport: PHONE, hasTouch: true });

  test('elegible con beforeinstallprompt: la hoja se abre sola con la copia de TABA', async ({ page }) => {
    await armInstallPrompt(page);
    await abrir(page);
    await page.evaluate(() => window.__fireBeforeInstallPrompt());

    await expect(sheet(page)).toBeVisible();
    await expect(view(page, 'android')).toBeVisible();
    await expect(view(page, 'ios')).toBeHidden();
    await expect(sheet(page)).toContainText('Llevá La Taba con vos');
    await expect(sheet(page)).toContainText('Agregá La Taba a tu celular para entrar más rápido a tus pedidos.');
    await expect(page.locator('[data-install-accept]')).toHaveText('Instalar La Taba');
    await expect(page.locator('[data-install-view="android"] [data-install-decline]')).toHaveText('Ahora no');
    // Nada se guardó todavía: la persona no decidió nada.
    expect(await storedDecision(page)).toBe(null);
  });

  /*
   * EL EVENTO QUE LLEGA MIENTRAS LA TIENDA TODAVÍA SE ESTÁ ARMANDO.
   *
   * `beforeinstallprompt` es de UN SOLO USO y no se repite: perdérselo es
   * perder la instalación de esa visita entera —ni hoja, ni tarjeta en el
   * Perfil, o sea NINGÚN camino, ni el automático ni el manual—.
   *
   * Y había una ventana real para perderlo. `js/app.js` es un módulo, o sea
   * diferido, y cablea la invitación al FINAL de `bootstrap()`, después de
   * traer el catálogo por red. Entre que el documento termina de parsearse y
   * que se llega a esa línea puede haber segundos, y Chrome dispara el evento
   * justo ahí: pide interacción previa para ofrecer instalar, así que suele
   * llegar en la SEGUNDA visita, con el worker ya activo y todo caliente.
   *
   * Acá esa ventana se abre a propósito: se demora el módulo de la interfaz
   * tres segundos y el evento se dispara a los 300 ms. Los scripts CLÁSICOS del
   * shell —entre ellos `js/pwa-update.js`, que es quien lo captura— ya
   * corrieron; el módulo todavía no. Si alguien vuelve a cablear la captura
   * dentro del módulo, este test se pone rojo.
   */
  test('el evento que llega mientras la tienda se arma no se pierde', async ({ page }) => {
    await page.route('**/js/pwa-install-ui.js*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await route.continue();
    });
    await page.addInitScript(() => {
      window.__install = { prompts: 0, outcome: 'accepted' };
      setTimeout(() => {
        const event = new Event('beforeinstallprompt');
        event.prompt = async () => {
          window.__install.prompts += 1;
          return { outcome: window.__install.outcome, platform: 'web' };
        };
        event.userChoice = Promise.resolve({ outcome: window.__install.outcome });
        window.dispatchEvent(event);
        window.__disparado = true;
      }, 300);
    });
    await abrir(page);

    // El evento salió antes de que existiera el módulo que antes lo escuchaba.
    expect(await page.evaluate(() => window.__disparado)).toBe(true);
    /*
     * Presupuesto ancho a propósito: este test le suma 3 s de demora al módulo
     * ENCIMA del arranque, y si le toca ser la primera navegación de la corrida
     * paga además el grafo frío (50 s medidos contra 1-8 s de las siguientes).
     * Con 20 s se ponía rojo en frío y verde en caliente, que es la peor clase
     * de prueba: la que depende de en qué orden la corras.
     */
    await expect(sheet(page)).toBeVisible({ timeout: 60_000 });
    await expect(view(page, 'android')).toBeVisible();
    // Y el prompt capturado por el shell sigue sirviendo para instalar.
    await page.locator('[data-install-accept]').click();
    await expect.poll(() => page.evaluate(() => window.__install.prompts)).toBe(1);
  });

  test('sin el evento disponible no aparece nada, y no se finge un botón', async ({ page }) => {
    await abrir(page);
    await page.waitForTimeout(VENTANA_SIN_INVITACION);
    await expect(sheet(page)).toBeHidden();
    // Tampoco la entrada del Perfil: no hay instalación real que ofrecer.
    await page.goto('/?demo=1#perfil', { waitUntil: 'domcontentloaded' });
    await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached' });
    await expect(entry(page)).toBeHidden();
  });

  test('aceptar: llama al prompt nativo UNA vez, cierra la hoja y lo recuerda', async ({ page }) => {
    await armInstallPrompt(page);
    await abrir(page);
    await page.evaluate(() => window.__fireBeforeInstallPrompt());
    await expect(sheet(page)).toBeVisible();

    await page.locator('[data-install-accept]').click();
    await expect(sheet(page)).toBeHidden();
    await expect.poll(() => storedDecision(page)).toBe('accepted');
    expect(await page.evaluate(() => window.__install.prompts)).toBe(1);

    // El evento es de un solo uso: la entrada del Perfil ya no lo ofrece.
    await page.goto('/?demo=1#perfil', { waitUntil: 'domcontentloaded' });
    await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached' });
    await expect(entry(page)).toBeHidden();
  });

  test('rechazar el prompt nativo: se recuerda y no se vuelve a invitar sola', async ({ page }) => {
    await armInstallPrompt(page);
    await abrir(page);
    await page.evaluate(() => { window.__install.outcome = 'dismissed'; window.__fireBeforeInstallPrompt(); });
    await expect(sheet(page)).toBeVisible();

    await page.locator('[data-install-accept]').click();
    await expect.poll(() => storedDecision(page)).toBe('declined');

    await abrir(page);
    await page.evaluate(() => window.__fireBeforeInstallPrompt());
    await page.waitForTimeout(VENTANA_SIN_INVITACION);
    await expect(sheet(page)).toBeHidden();
  });

  test('"Ahora no": la hoja no vuelve en la siguiente carga, y el Perfil sí la ofrece', async ({ page }) => {
    await armInstallPrompt(page);
    await abrir(page);
    await page.evaluate(() => window.__fireBeforeInstallPrompt());
    await expect(sheet(page)).toBeVisible();

    await page.locator('[data-install-view="android"] [data-install-decline]').click();
    await expect(sheet(page)).toBeHidden();
    await expect.poll(() => storedDecision(page)).toBe('declined');

    // Recarga: la decisión sobrevive y la invitación no reaparece.
    await abrir(page);
    expect(await storedDecision(page)).toBe('declined');
    await page.evaluate(() => window.__fireBeforeInstallPrompt());
    await page.waitForTimeout(VENTANA_SIN_INVITACION);
    await expect(sheet(page)).toBeHidden();

    // La puerta de atrás sigue abierta.
    await page.locator('.mobile-nav [data-nav-view="catalog"]').waitFor();
    await page.evaluate(() => { window.location.hash = 'perfil'; });
    await expect(entry(page)).toBeVisible();
    await expect(entry(page)).toContainText('Instalar La Taba');
    await page.locator('[data-install-entry-action]').click();
    await expect.poll(() => page.evaluate(() => window.__install.prompts)).toBe(1);
  });

  test('appinstalled: cierra la hoja, lo recuerda y retira la entrada del Perfil', async ({ page }) => {
    await armInstallPrompt(page);
    await abrir(page);
    await page.evaluate(() => window.__fireBeforeInstallPrompt());
    await expect(sheet(page)).toBeVisible();

    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await expect(sheet(page)).toBeHidden();
    await expect.poll(() => storedDecision(page)).toBe('installed');
    await page.evaluate(() => { window.location.hash = 'perfil'; });
    await expect(entry(page)).toBeHidden();
  });

  test('ya instalada (standalone): ni hoja, ni entrada, y la barra respeta el borde', async ({ page }) => {
    await pretendStandalone(page);
    await armInstallPrompt(page);
    await abrir(page);
    await page.evaluate(() => window.__fireBeforeInstallPrompt());
    await page.waitForTimeout(VENTANA_SIN_INVITACION);

    await expect(sheet(page)).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('data-taba-display-mode', 'standalone');
    await page.evaluate(() => { window.location.hash = 'perfil'; });
    await expect(entry(page)).toBeHidden();
  });

  test('no se abre encima de un dedo que está usando la tienda', async ({ page }) => {
    /*
     * Este test existe por un defecto medido, no por precaución: en WebKit
     * móvil la hoja se abrió sobre el "+" de un producto mientras alguien sumaba
     * unidades, y se quedó con el toque siguiente. Estar en una vista permitida
     * dice DÓNDE está la persona; no dice si está haciendo algo.
     */
    await armInstallPrompt(page);
    await abrir(page);
    // Primero se ocupa el dedo, después llega el evento: al revés la hoja se
    // abriría de inmediato y el test no mediría nada.
    await page.keyboard.press('Shift');
    await page.evaluate(() => window.__fireBeforeInstallPrompt());

    for (let toque = 0; toque < 8; toque += 1) {
      await page.keyboard.press('Shift');
      await page.waitForTimeout(500);
      expect(await sheet(page).isVisible(), `la hoja se abrió durante el toque ${toque + 1}`).toBe(false);
    }

    // Al parar, la invitación llega sola: no se perdió, se esperó.
    await expect(sheet(page)).toBeVisible({ timeout: 10_000 });
  });

  test('no interrumpe el checkout: en el carrito no se abre, y sí al volver al inicio', async ({ page }) => {
    await armInstallPrompt(page);
    await page.goto('/?demo=1#carrito', { waitUntil: 'domcontentloaded' });
    await page.locator('html[data-taba-startup="ready"]').waitFor({ state: 'attached' });
    await page.evaluate(() => window.__fireBeforeInstallPrompt());
    await page.waitForTimeout(VENTANA_SIN_INVITACION);
    await expect(sheet(page)).toBeHidden();

    // Al salir del checkout la ventana se abre sin necesidad de recargar.
    await page.evaluate(() => { window.location.hash = 'inicio'; });
    await expect(sheet(page)).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('iPhone', () => {
  test.use({ userAgent: IPHONE_UA, viewport: PHONE, hasTouch: true });

  test('no instalada: se ofrece la guía, y "Ver cómo" muestra los tres pasos', async ({ page }) => {
    await abrir(page);
    await expect(sheet(page)).toBeVisible({ timeout: 10_000 });
    await expect(view(page, 'ios')).toBeVisible();
    await expect(view(page, 'android')).toBeHidden();
    await expect(sheet(page)).toContainText('Agregá La Taba a tu inicio');
    await expect(sheet(page)).toContainText('Tené La Taba como una app en tu iPhone.');

    await page.locator('[data-install-ios-how]').click();
    await expect(view(page, 'ios-steps')).toBeVisible();
    await expect(view(page, 'ios')).toBeHidden();
    const pasos = page.locator('[data-install-view="ios-steps"] .install-steps li');
    await expect(pasos).toHaveCount(3);
    await expect(pasos.nth(0)).toContainText('Compartir');
    await expect(pasos.nth(1)).toContainText('Agregar a pantalla de inicio');
    await expect(pasos.nth(2)).toContainText('Agregar');
    // En Safari el botón vive en la barra de abajo; el texto lo dice.
    await expect(page.locator('[data-install-steps-where]')).toHaveText('en la barra de abajo de Safari.');
    // Y no se afirma que quedó instalada: eso sólo se detecta en otra apertura.
    await expect(sheet(page)).not.toContainText('instalada');
  });

  test('nunca se llama a un prompt de instalación que en iOS no existe', async ({ page }) => {
    await abrir(page);
    await expect(sheet(page)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-install-accept]')).toBeHidden();
  });

  test('ya instalada (navigator.standalone): no aparece nada', async ({ page }) => {
    await pretendIOSStandalone(page);
    await abrir(page);
    await page.waitForTimeout(VENTANA_SIN_INVITACION);
    await expect(sheet(page)).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('data-taba-display-mode', 'standalone');
    await page.evaluate(() => { window.location.hash = 'perfil'; });
    await expect(entry(page)).toBeHidden();
  });

  test('quien ya la descartó conserva la entrada del Perfil con el texto de iOS', async ({ page }) => {
    await seedDecision(page, 'declined');
    await abrir(page, '/?demo=1#perfil');
    await page.waitForTimeout(VENTANA_SIN_INVITACION);
    await expect(sheet(page)).toBeHidden();

    await expect(entry(page)).toBeVisible();
    await expect(entry(page)).toContainText('Agregá La Taba al inicio');
    await expect(page.locator('[data-install-entry-action]')).toHaveText('Ver cómo');
    await page.locator('[data-install-entry-action]').click();
    await expect(sheet(page)).toBeVisible();
    await expect(view(page, 'ios')).toBeVisible();
  });
});

test.describe('iPhone · Chrome', () => {
  test.use({ userAgent: IOS_CHROME_UA, viewport: PHONE, hasTouch: true });

  /*
   * El pedido lo dice con todas las letras: no decirle "tocá Compartir de
   * Safari" a quien no está en Safari. Es el mismo motor, así que la guía
   * sirve igual; lo que cambia es DÓNDE está el botón, y esa frase es lo
   * único que separa una guía de una pista falsa.
   */
  test('la guía manda al menú de SU navegador, no a la barra de Safari', async ({ page }) => {
    await abrir(page);
    await expect(sheet(page)).toBeVisible({ timeout: 10_000 });
    await expect(view(page, 'ios')).toBeVisible();

    await page.locator('[data-install-ios-how]').click();
    await expect(view(page, 'ios-steps')).toBeVisible();
    await expect(page.locator('[data-install-steps-where]')).toHaveText('en el menú de tu navegador.');
    await expect(view(page, 'ios-steps')).not.toContainText('barra de abajo de Safari');
    // Está EN un navegador, así que no se le dice que salga a otro.
    await expect(page.locator('[data-install-steps-lead]')).toBeHidden();
    // Y sigue sin haber un botón que prometa instalar: en iOS no existe la API.
    await expect(page.locator('[data-install-accept]')).toBeHidden();
  });
});

test.describe('iPhone · dentro de otra app (WebView)', () => {
  test.use({ userAgent: IOS_WEBVIEW_UA, viewport: PHONE, hasTouch: true });

  /*
   * Acá la opción NO EXISTE: el Compartir del navegador embebido de Instagram
   * no ofrece "Agregar a pantalla de inicio". Abrir una guía sola sería mandar
   * a alguien a buscar un botón que no está, así que no se invita; y si la
   * persona la pide desde el Perfil, lo primero que lee es que tiene que salir
   * a Safari.
   */
  test('no se auto-invita, y la guía pedida arranca mandando a Safari', async ({ page }) => {
    await abrir(page);
    await page.waitForTimeout(VENTANA_SIN_INVITACION);
    await expect(sheet(page)).toBeHidden();

    await page.evaluate(() => { window.location.hash = 'perfil'; });
    await expect(entry(page)).toBeVisible();
    await expect(entry(page)).toContainText('Agregá La Taba al inicio');

    await page.locator('[data-install-entry-action]').click();
    await expect(sheet(page)).toBeVisible();
    await expect(view(page, 'ios')).toBeVisible();
    await page.locator('[data-install-ios-how]').click();

    const lead = page.locator('[data-install-steps-lead]');
    await expect(lead).toBeVisible();
    await expect(lead).toContainText('Safari');
    // No se promete una instalación que dentro del WebView no puede ocurrir.
    await expect(page.locator('[data-install-accept]')).toBeHidden();
  });
});

test.describe('Escritorio', () => {
  // El user agent se declara aunque parezca redundante: este archivo también
  // corre en el proyecto `mobile-webkit`, donde el device por defecto ES un
  // iPhone. Sin esta línea, "escritorio" sería un teléfono con otro nombre.
  test.use({ userAgent: DESKTOP_UA, viewport: { width: 1280, height: 900 }, hasTouch: false, isMobile: false });

  test('no recibe la invitación automática aunque el navegador ofrezca instalar', async ({ page }) => {
    await armInstallPrompt(page);
    await abrir(page);
    await page.evaluate(() => window.__fireBeforeInstallPrompt());
    await page.waitForTimeout(VENTANA_SIN_INVITACION);
    await expect(sheet(page)).toBeHidden();

    // La instalación desde escritorio existe: vive en el Perfil, sin molestar.
    await page.evaluate(() => { window.location.hash = 'perfil'; });
    await expect(entry(page)).toBeVisible();
    await page.locator('[data-install-entry-action]').click();
    await expect.poll(() => page.evaluate(() => window.__install.prompts)).toBe(1);
  });
});
