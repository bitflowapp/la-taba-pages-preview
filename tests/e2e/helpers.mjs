import { expect } from '@playwright/test';

export async function installBrowserStubs(page) {
  await page.addInitScript(() => {
    window.__openedUrls = [];
    window.__clipboardText = '';
    window.open = (...args) => {
      window.__openedUrls.push(String(args[0] || ''));
      return null;
    };
    const clipboardStub = {
      writeText: async (text) => {
        window.__clipboardText = String(text);
      },
      readText: async () => window.__clipboardText,
    };
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: navigator.clipboard ? {
          ...navigator.clipboard,
          writeText: async (text) => {
            window.__clipboardText = String(text);
          },
          readText: async () => window.__clipboardText,
        } : clipboardStub,
      });
    } catch (_) {
      navigator.clipboard = clipboardStub;
    }
    localStorage.clear();
    sessionStorage.clear();
  });
}

export function installPageGuards(page) {
  const errors = [];
  const badResponses = [];

  page.on('pageerror', (error) => {
    errors.push(error);
  });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      const text = message.text();
      if (!text.includes('Failed to load resource') && !text.includes('Service Worker')) {
        errors.push(new Error(text));
      }
    }
  });

  page.on('response', (response) => {
    const status = response.status();
    if (status >= 400) {
      const request = response.request();
      const url = response.url();
      const resourceType = request.resourceType();
      if (resourceType !== 'xhr' && resourceType !== 'fetch') {
        badResponses.push(`${status} ${resourceType} ${url}`);
      }
    }
  });

  return {
    errors,
    badResponses,
    async assertClean() {
      expect(errors, errors.map((error) => error.message)).toEqual([]);
      expect(badResponses, badResponses.join('\n')).toEqual([]);
    },
  };
}

export async function waitForToast(page, text) {
  await expect(page.locator('[data-toast]')).toContainText(text);
}

export async function fillCheckout(page, { name, phone, address, notes, payment = 'cash', deliveryMode = 'delivery' }) {
  await page.getByLabel('Nombre').fill(name);
  await page.getByLabel('Teléfono').fill(phone);
  await page.getByLabel('Forma de pago').selectOption(payment);
  await page.getByLabel('Notas').fill(notes);
  if (deliveryMode === 'delivery') {
    await page.getByLabel('Dirección').fill(address);
    await page.getByLabel('Envío a domicilio').check();
  } else {
    await page.getByLabel('Retiro en local').check();
  }
}

export async function openFirstProductModal(page) {
  await page.locator('[data-product-grid] [data-product-detail]').first().click();
  await expect(page.locator('[data-product-modal]')).toBeVisible();
}
