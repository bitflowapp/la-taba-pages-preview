import { expect, test } from '@playwright/test';
import {
  DEFAULT_CHECKOUT_ADDRESSES,
  gotoDemoReset,
  installBrowserStubs,
  seedCartAboveMinimum,
  seedCheckoutProfile,
  seededConfirmedPoint,
  selectCheckoutAddress,
} from './helpers.mjs';

/*
 * DECLARAR DÓNDE RECIBÍS NO PUEDE COSTAR LA PANTALLA EN LA QUE ESTÁS
 *
 * Los tres defectos que esta suite cierra se midieron sobre el sitio publicado:
 *
 *   1. «ENVIAR A · Elegí tu dirección» era `data-nav-view="profile"`. Tocarlo
 *      cambiaba de vista: se perdía el listado, el filtro, la búsqueda y el
 *      lugar del scroll.
 *   2. El checkout sin dirección ofrecía «Agregar dirección en Perfil», así que
 *      completar la compra exigía abandonar el checkout con el carrito cargado.
 *   3. Llegando a Perfil desde el inicio no había retorno: `data-nav-view` a
 *      Perfil LIMPIA la marca de retorno, y «Volver al pedido» sólo se dibuja
 *      cuando el que mandó fue el checkout.
 *
 * Lo que NO cambia y esta suite también sostiene: quien ya tiene una dirección
 * predeterminada con punto confirmado sigue viendo exactamente lo de antes.
 */

// Teléfono, que es donde ocurre. El resto de los anchos se miden en su propio
// caso, más abajo.
test.use({ viewport: { width: 390, height: 844 } });

const CATALOGO = '/?demo=1&demo-reset=1#catalog';

test.describe('Dirección · la hoja del encabezado', () => {
  test('elegir dirección desde el inicio no abandona la vista, y cerrar la devuelve intacta', async ({ page }) => {
    await installBrowserStubs(page);
    await gotoDemoReset(page, CATALOGO);
    await seedCheckoutProfile(page);

    // Un estado que se PIERDE si la vista cambia: una búsqueda escrita.
    const buscador = page.locator('[data-search-input] >> visible=true').first();
    await buscador.fill('cerveza');
    await expect(buscador).toHaveValue('cerveza');
    await expect(page.locator('body')).toHaveAttribute('data-active-view', 'catalog');

    const chip = page.locator('[data-home-address]');
    // El control declara que abre un diálogo, y ya no una ruta.
    await expect(chip).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(chip).toHaveCount(1);
    expect(await chip.getAttribute('data-nav-view')).toBeNull();

    await chip.click();
    const hoja = page.locator('[data-address-sheet]');
    await expect(hoja).toBeVisible();
    await expect(hoja).toContainText('¿Dónde te entregamos?');
    // La vista de atrás NO cambió.
    await expect(page.locator('body')).toHaveAttribute('data-active-view', 'catalog');

    // Y el fondo no se desplaza detrás de la hoja.
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');

    await hoja.locator('[data-address-sheet-action="close"]').click();
    await expect(hoja).toBeHidden();
    await expect(page.locator('body')).toHaveAttribute('data-active-view', 'catalog');
    await expect(buscador).toHaveValue('cerveza');
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  });

  test('cambiar de dirección en la hoja cambia el destino del checkout', async ({ page }) => {
    await installBrowserStubs(page);
    await gotoDemoReset(page, CATALOGO);
    const sembradas = await seedCheckoutProfile(page);

    await page.locator('[data-home-address]').click();
    const hoja = page.locator('[data-address-sheet]');
    await expect(hoja).toBeVisible();

    // La predeterminada se declara como la vigente.
    const principal = hoja.locator(`[data-address-id="${sembradas[0].id}"]`);
    await expect(principal).toHaveAttribute('aria-current', 'true');

    await hoja.locator(`[data-address-id="${sembradas[1].id}"]`).click();
    await expect(hoja).toBeHidden();

    // El chip del encabezado nombra la nueva, y el checkout la tiene elegida.
    await expect(page.locator('[data-home-address-label]'))
      .toContainText(DEFAULT_CHECKOUT_ADDRESSES[1].street);

    await seedCartAboveMinimum(page);
    await page.locator('[data-open-cart] >> visible=true').first().click();
    await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');
    await expect(
      page.locator('[data-profile-checkout] .profile-address-card.is-selected'),
    ).toHaveAttribute('data-customer-address-id', sembradas[1].id);
  });

  /*
   * «Usar mi ubicación» NO geocodifica: no hay geocodificador configurado y
   * fabricar uno acá sería inventar el dato que este contrato existe para no
   * inventar. Lo que hace es lo único que se puede sostener con lo que ya
   * existe: mide UNA vez y busca entre las direcciones guardadas una que caiga
   * dentro de la tolerancia de `findNearbySavedAddress` —la misma que usa el
   * detector de duplicados—. Si la hay, la elige; si no, la medición pasa al
   * editor como punto PENDIENTE, nunca confirmado.
   */
  test('«Usar mi ubicación» elige la dirección guardada que está en ese punto', async ({ page, context }) => {
    await installBrowserStubs(page);
    await gotoDemoReset(page, CATALOGO);
    const sembradas = await seedCheckoutProfile(page);
    await context.grantPermissions(['geolocation']);
    // El punto sembrado de la SEGUNDA dirección, para que elegirla sea un cambio
    // observable y no la predeterminada que ya estaba.
    await context.setGeolocation({ ...seededConfirmedPoint(1), accuracy: 12 });

    await page.locator('[data-home-address]').click();
    const hoja = page.locator('[data-address-sheet]');
    await hoja.locator('[data-address-sheet-action="use-location"]').click();

    await expect(hoja).toBeHidden();
    await expect(page.locator('[data-home-address-label]'))
      .toContainText(DEFAULT_CHECKOUT_ADDRESSES[1].street);
    await page.locator('[data-home-address]').click();
    await expect(hoja.locator(`[data-address-id="${sembradas[1].id}"]`)).toHaveAttribute('aria-current', 'true');
  });

  test('sin una dirección guardada en ese punto, la medición pasa al editor SIN confirmar', async ({ page, context }) => {
    await installBrowserStubs(page);
    await gotoDemoReset(page, CATALOGO);
    await seedCheckoutProfile(page);
    await context.grantPermissions(['geolocation']);
    // Lejos de todas las sembradas: ~4 km, muy por encima de la tolerancia.
    await context.setGeolocation({ latitude: -38.98, longitude: -68.09, accuracy: 12 });

    await page.locator('[data-home-address]').click();
    const hoja = page.locator('[data-address-sheet]');
    await hoja.locator('[data-address-sheet-action="use-location"]').click();

    const editor = hoja.locator('[data-address-capture="sheet"]');
    await expect(editor).toBeVisible();
    await expect(hoja.locator('[data-address-sheet-status]'))
      .toContainText('No encontramos una dirección guardada en ese punto');
    // El aparato dice dónde está el teléfono, no a qué puerta tocar: el punto
    // llega PENDIENTE y confirmarlo sigue siendo un acto explícito.
    const paso = editor.locator('[data-location-step]');
    await expect(paso).toHaveAttribute('data-location-status', 'pending');
    await expect(paso.locator('[data-location-coords]').first()).toContainText('-38.980000, -68.090000');
  });

  test('sin ninguna dirección la hoja abre directo en el editor, y guardar deja la dirección elegida', async ({ page }) => {
    await installBrowserStubs(page);
    await gotoDemoReset(page, CATALOGO);
    await seedCheckoutProfile(page, { addresses: [] });

    await page.locator('[data-home-address]').click();
    const hoja = page.locator('[data-address-sheet]');
    const editor = hoja.locator('[data-address-capture="sheet"]');
    await expect(editor).toBeVisible();

    await editor.locator('[name="captureAddressStreet"]').fill('Antártida Argentina');
    await editor.locator('[name="captureAddressNumber"]').fill('1450');

    // Guardar sin confirmar el punto no guarda nada: es el contrato, y la base
    // rechazaría el pedido igual, después de cobrar.
    await editor.locator('[data-profile-action="save-address"]').click();
    await expect(editor.locator('[data-address-capture-status]'))
      .toContainText('Confirmá en el mapa dónde te entregamos');

    const paso = editor.locator('[data-location-step]');
    await paso.locator('[data-profile-action="open-location-map"]').click();
    await expect(paso).toHaveAttribute('data-location-status', 'pending');
    await paso.locator('[data-profile-action="confirm-location"]').click();
    await expect(paso).toHaveAttribute('data-location-status', 'confirmed');

    await editor.locator('[data-profile-action="save-address"]').click();
    await expect(hoja).toBeHidden();
    await expect(page.locator('[data-home-address-label]')).toContainText('Antártida Argentina');
    await expect(page.locator('body')).toHaveAttribute('data-active-view', 'catalog');
  });

  /*
   * LA PRIMERA COMPRA, ENTERA, DESDE EL INICIO.
   *
   * Sin nombre ni teléfono guardados, la hoja los pide: no por diseño, sino
   * porque `upsert_current_customer_address` ABORTA sin la fila del cliente
   * («guardá primero tu nombre y telefono»). Y lo que queda guardado tiene que
   * llegar al checkout: sin el puente, esta misma persona abría el carrito y
   * encontraba «Completá tu perfil» sobre el perfil que acababa de completar.
   */
  test('sin perfil, la hoja pide nombre y teléfono, y el checkout se entera', async ({ page }) => {
    await installBrowserStubs(page);
    await gotoDemoReset(page, CATALOGO);
    await seedCheckoutProfile(page, { name: '', phone: '', addresses: [], namespace: 'primera-compra' });
    await seedCartAboveMinimum(page);

    await page.locator('[data-home-address]').click();
    const editor = page.locator('[data-address-capture="sheet"]');
    await expect(editor.locator('[data-address-capture-identity]')).toBeVisible();

    // Un teléfono inválido no guarda nada y lo dice sobre el campo.
    await editor.locator('[name="captureCustomerName"]').fill('Camila Ríos');
    await editor.locator('[name="captureCustomerPhone"]').fill('12');
    await editor.locator('[name="captureAddressStreet"]').fill('Río Limay');
    await editor.locator('[name="captureAddressNumber"]').fill('64');
    const paso = editor.locator('[data-location-step]');
    await paso.locator('[data-profile-action="open-location-map"]').click();
    await paso.locator('[data-profile-action="confirm-location"]').click();
    await editor.locator('[data-profile-action="save-address"]').click();
    await expect(editor.locator('[data-address-capture-status]')).toContainText('teléfono argentino válido');
    await expect(editor.locator('[name="captureCustomerPhone"]')).toHaveAttribute('aria-invalid', 'true');
    // Y lo escrito sigue ahí: un rechazo de validación no puede costar el formulario.
    await expect(editor.locator('[name="captureAddressStreet"]')).toHaveValue('Río Limay');
    await expect(paso).toHaveAttribute('data-location-status', 'confirmed');

    await editor.locator('[name="captureCustomerPhone"]').fill('2995550100');
    await editor.locator('[data-profile-action="save-address"]').click();
    await expect(page.locator('[data-address-sheet]')).toBeHidden();

    // El checkout ya no pide el perfil: lo tiene.
    await page.locator('[data-open-cart] >> visible=true').first().click();
    await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');
    await expect(page.locator('[data-profile-block="incomplete"]')).toHaveCount(0);
    await expect(page.locator('[data-profile-name]')).toHaveText('Camila Ríos');
    await expect(page.locator('[data-profile-checkout] .profile-address-card.is-selected'))
      .toContainText('Río Limay 64');
  });
});

test.describe('Dirección · el editor dentro del checkout', () => {
  test('sin dirección, el checkout no manda a Perfil: pide los datos ahí mismo', async ({ page }) => {
    await installBrowserStubs(page);
    await gotoDemoReset(page, CATALOGO);
    await seedCheckoutProfile(page, { addresses: [] });
    await seedCartAboveMinimum(page);
    await page.locator('[data-open-cart] >> visible=true').first().click();
    await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');

    const bloque = page.locator('[data-profile-block="no-address"]');
    await expect(bloque).toBeVisible();
    // Ya no existe la salida a Perfil como camino para comprar.
    await expect(bloque).not.toContainText('en Perfil');
    await bloque.locator('[data-profile-checkout-action="new-address"]').click();

    const editor = page.locator('[data-address-capture="checkout"]');
    await expect(editor).toBeVisible();
    // Y seguimos en el carrito: el carrito sigue cargado detrás.
    await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');
    await expect(page.locator('[data-cart-list] .cart-item')).not.toHaveCount(0);

    await editor.locator('[name="captureAddressStreet"]').fill('Avenida Olascoaga');
    await editor.locator('[name="captureAddressNumber"]').fill('755');
    const paso = editor.locator('[data-location-step]');
    await paso.locator('[data-profile-action="open-location-map"]').click();
    await paso.locator('[data-profile-action="confirm-location"]').click();
    await editor.locator('[data-profile-action="save-address"]').click();

    // Queda guardada Y elegida: guardar y después tener que elegir sería pedir
    // dos veces la misma decisión.
    const elegida = page.locator('[data-profile-checkout] .profile-address-card.is-selected');
    await expect(elegida).toHaveCount(1);
    await expect(elegida).toContainText('Avenida Olascoaga 755');
    await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');
  });

  test('con direcciones guardadas el selector no cambia, y «Nueva dirección» abre el editor en línea', async ({ page }) => {
    await installBrowserStubs(page);
    await gotoDemoReset(page, CATALOGO);
    const sembradas = await seedCheckoutProfile(page);
    await seedCartAboveMinimum(page);
    await page.locator('[data-open-cart] >> visible=true').first().click();

    // El camino del cliente recurrente, intacto.
    const lista = page.locator('[data-profile-checkout] .profile-address-list');
    await expect(lista).toBeVisible();
    await expect(page.locator('[data-profile-checkout] .profile-address-card.is-selected'))
      .toHaveAttribute('data-customer-address-id', sembradas[0].id);
    await selectCheckoutAddress(page, { id: sembradas[1].id });
    await expect(page.locator('[data-profile-checkout] .profile-address-card.is-selected'))
      .toHaveAttribute('data-customer-address-id', sembradas[1].id);
    // Y «Administrar en Perfil» sigue existiendo: Perfil no desapareció, dejó de
    // ser un requisito.
    await expect(page.locator('[data-profile-checkout-action="manage-addresses"]')).toHaveCount(1);

    await page.locator('[data-checkout-new-address]').click();
    const editor = page.locator('[data-address-capture="checkout"]');
    await expect(editor).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');

    // Cerrar devuelve el selector con la misma elección.
    await editor.locator('[data-address-capture-close]').click();
    await expect(editor).toHaveCount(0);
    await expect(page.locator('[data-profile-checkout] .profile-address-card.is-selected'))
      .toHaveAttribute('data-customer-address-id', sembradas[1].id);
  });

  test('retiro en local no queda bloqueado por la dirección', async ({ page }) => {
    await installBrowserStubs(page);
    await gotoDemoReset(page, CATALOGO);
    await seedCheckoutProfile(page, { addresses: [] });
    await seedCartAboveMinimum(page);
    await page.locator('[data-open-cart] >> visible=true').first().click();

    await expect(page.locator('[data-profile-block="no-address"]')).toBeVisible();
    await page.getByLabel('Retiro en local').check();
    await expect(page.locator('[data-profile-pickup]')).toBeVisible();
    await expect(page.locator('[data-profile-block="no-address"]')).toHaveCount(0);
    await expect(page.locator('[data-address-capture="checkout"]')).toHaveCount(0);
  });

  /*
   * La regla REAL de invalidación, y no la simétrica que parecería.
   *
   * `draftAfterAddressEdit` sólo tira abajo una confirmación de origen `saved`:
   * la que se REUTILIZA de una dirección guardada mientras se edita su texto.
   * Una confirmación FRESCA sobrevive a que se siga escribiendo, porque no
   * arrastra ninguna dirección anterior — y porque invalidarla dejaba a la
   * persona sin poder guardar nunca: el paso está debajo de los campos, así que
   * marcar el pin y después terminar de escribir es el orden natural.
   *
   * Las dos mitades se prueban acá, en el navegador, sobre las dos superficies
   * donde cada una es alcanzable.
   */
  test('una confirmación FRESCA sobrevive a seguir escribiendo la dirección', async ({ page }) => {
    await installBrowserStubs(page);
    await gotoDemoReset(page, CATALOGO);
    await seedCheckoutProfile(page, { addresses: [] });
    await seedCartAboveMinimum(page);
    await page.locator('[data-open-cart] >> visible=true').first().click();
    await page.locator('[data-profile-checkout-action="new-address"]').click();

    const editor = page.locator('[data-address-capture="checkout"]');
    await editor.locator('[name="captureAddressStreet"]').fill('Antártida Argentina');
    const paso = editor.locator('[data-location-step]');
    await paso.locator('[data-profile-action="open-location-map"]').click();
    await paso.locator('[data-profile-action="confirm-location"]').click();
    await expect(paso).toHaveAttribute('data-location-status', 'confirmed');

    // El número se escribe DESPUÉS de confirmar, que es el orden humano.
    await editor.locator('[name="captureAddressNumber"]').fill('1450');
    await editor.locator('[name="captureAddressNumber"]').blur();
    await expect(paso).toHaveAttribute('data-location-status', 'confirmed');

    await editor.locator('[data-profile-action="save-address"]').click();
    await expect(page.locator('[data-profile-checkout] .profile-address-card.is-selected'))
      .toContainText('Antártida Argentina 1450');
  });

  test('editar el texto de un pin YA GUARDADO obliga a reconfirmarlo', async ({ page }) => {
    await installBrowserStubs(page);
    await gotoDemoReset(page, CATALOGO);
    await seedCheckoutProfile(page);
    await seedCartAboveMinimum(page);
    await page.locator('[data-open-cart] >> visible=true').first().click();

    // La reutilización de una confirmación guardada sólo ocurre al EDITAR una
    // dirección existente, y editar direcciones es administración: vive en
    // Perfil, al que el checkout sigue enlazando. La ida ya no es obligatoria
    // para comprar, y la vuelta sigue estando.
    await page.locator('[data-profile-checkout-action="manage-addresses"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-active-view', 'profile');
    const perfil = page.locator('[data-customer-profile]');
    await expect(perfil.locator('[data-profile-action="return-to-checkout"]').first()).toBeVisible();

    await perfil.locator('[data-profile-address-id] [data-profile-action="edit-address"]').first().click();
    const paso = perfil.locator('[data-location-step]');
    await expect(paso).toHaveAttribute('data-location-status', 'confirmed');

    const calle = perfil.locator('[name="profileAddressStreet"]');
    await calle.fill('Rivadavia');
    // `change` se dispara al salir del campo, no al teclear: revisar la
    // confirmación no puede pelearle el foco a quien está escribiendo.
    await calle.blur();
    await expect(paso).not.toHaveAttribute('data-location-status', 'confirmed');
  });
});

test.describe('Dirección · teléfono', () => {
  // 320 es el ancho más angosto que la tienda declara soportar; 430 el más
  // ancho de la familia iPhone. Se miden los dos extremos y el del medio.
  for (const ancho of [320, 390, 430]) {
    test(`el editor entra sin desbordar ni disparar el zoom de Safari a ${ancho}px`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: 780 });
      await installBrowserStubs(page);
      await gotoDemoReset(page, CATALOGO);
      await seedCheckoutProfile(page, { addresses: [] });

      await page.locator('[data-home-address]').click();
      const editor = page.locator('[data-address-capture="sheet"]');
      await expect(editor).toBeVisible();
      /*
       * La hoja entra con 360 ms de animación (`dialog[open]` en motion.css:
       * `scale(0.985)` → `none`). Medir durante ese tramo devuelve TODO un 1,5%
       * más chico —44px leídos como 43,34— y eso es medir la animación, no el
       * diseño.
       *
       * Se espera la animación y no el valor computado de `transform`: WebKit
       * informa `none` mientras la animación acelerada sigue encogiendo la caja,
       * así que mirar el valor daba por terminada una animación en curso y el
       * caso fallaba sólo en Safari.
       */
      await page.waitForFunction(() => {
        const hoja = document.querySelector('[data-address-sheet]');
        return hoja.getAnimations({ subtree: true })
          .every((animacion) => ['finished', 'idle'].includes(animacion.playState));
      });

      const medida = await page.evaluate(() => {
        const raiz = document.querySelector('[data-address-capture="sheet"]');
        const campos = [...raiz.querySelectorAll('input:not([type="checkbox"]), select, textarea')];
        return {
          scrollHorizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          desbordan: campos.filter((campo) => {
            const caja = campo.getBoundingClientRect();
            return caja.right > window.innerWidth + 0.5 || caja.left < -0.5;
          }).length,
          chicos: campos.filter((campo) => {
            const estilo = getComputedStyle(campo);
            return Number.parseFloat(estilo.fontSize) < 16
              || campo.getBoundingClientRect().height < 44;
          }).map((campo) => campo.name),
          controlesChicos: [...raiz.querySelectorAll('button')]
            .filter((boton) => boton.getBoundingClientRect().height < 44)
            .map((boton) => boton.textContent.trim().slice(0, 24)),
        };
      });

      expect(medida.scrollHorizontal, 'la página no puede desplazarse a lo ancho').toBeLessThanOrEqual(0);
      expect(medida.desbordan, 'ningún campo puede salirse de la pantalla').toBe(0);
      // 16px es el umbral por debajo del cual Safari en iPhone hace zoom al
      // enfocar; 44px es el objetivo táctil mínimo.
      expect(medida.chicos).toEqual([]);
      expect(medida.controlesChicos).toEqual([]);
    });
  }
});

test.describe('Dirección · red y navegación', () => {
  test('volver atrás desde la hoja no pierde el carrito ni la vista', async ({ page }) => {
    await installBrowserStubs(page);
    await gotoDemoReset(page, CATALOGO);
    await seedCheckoutProfile(page);
    await seedCartAboveMinimum(page);

    const contador = page.locator('[data-cart-count] >> visible=true').first();
    const antes = String(await contador.textContent()).trim();

    await page.locator('[data-open-cart] >> visible=true').first().click();
    await expect(page.locator('body')).toHaveAttribute('data-active-view', 'cart');

    // La hoja NO agrega una entrada al historial: es un diálogo, no una ruta. Un
    // «atrás» después de cerrarla tiene que devolver la vista anterior, no
    // reabrirla ni salirse de la tienda.
    await page.locator('[data-home-address]').click();
    await expect(page.locator('[data-address-sheet]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-address-sheet]')).toBeHidden();

    await page.goBack();
    await expect(page.locator('body')).toHaveAttribute('data-active-view', 'catalog');
    await expect(page.locator('[data-cart-count] >> visible=true').first()).toHaveText(antes);
    await expect(page.locator('[data-address-sheet]')).toBeHidden();
  });

  test('sin conexión el editor conserva lo escrito y lo dice', async ({ page, context }) => {
    await installBrowserStubs(page);
    await gotoDemoReset(page, CATALOGO);
    await seedCheckoutProfile(page, { addresses: [] });

    await page.locator('[data-home-address]').click();
    const editor = page.locator('[data-address-capture="sheet"]');
    await editor.locator('[name="captureAddressStreet"]').fill('Río Limay');
    await editor.locator('[name="captureAddressNumber"]').fill('64');
    // Las referencias viven bajo «Agregar detalles de entrega»: no son una
    // decisión de la primera compra y no ocupan el espacio principal. Se abre
    // igual que lo haría una persona que sí quiere dejar una indicación.
    await editor.locator('[data-address-capture-optional] > summary').click();
    await editor.locator('[name="captureAddressReference"]').fill('Portón de madera');
    const paso = editor.locator('[data-location-step]');
    await paso.locator('[data-profile-action="open-location-map"]').click();
    await paso.locator('[data-profile-action="confirm-location"]').click();

    // Cae la red DESPUÉS de escribir. Lo tipeado no puede evaporarse: es todo lo
    // que la persona tiene, y volver a pedirlo es perder la compra.
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(editor.locator('[name="captureAddressStreet"]')).toHaveValue('Río Limay');
    await expect(editor.locator('[name="captureAddressNumber"]')).toHaveValue('64');
    await expect(editor.locator('[name="captureAddressReference"]')).toHaveValue('Portón de madera');
    await expect(paso).toHaveAttribute('data-location-status', 'confirmed');
    await context.setOffline(false);
  });
});
