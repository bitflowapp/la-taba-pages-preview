# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ios-phantom-scroll.spec.mjs >> Scroll fantasma · 390x844 >> Checkout con teclado simulado
- Location: tests\e2e\ios-phantom-scroll.spec.mjs:239:5

# Error details

```
Error: page.goto: Could not connect to server
Call log:
  - navigating to "http://127.0.0.1:38202/?reset=1&demo=1#catalog", waiting until "load"

```

# Test source

```ts
  1   | import { expect } from '@playwright/test';
  2   | 
  3   | export async function installBrowserStubs(page) {
  4   |   await page.addInitScript(() => {
  5   |     window.__openedUrls = [];
  6   |     window.__clipboardText = '';
  7   |     window.open = (...args) => {
  8   |       window.__openedUrls.push(String(args[0] || ''));
  9   |       return null;
  10  |     };
  11  |     const clipboardStub = {
  12  |       writeText: async (text) => {
  13  |         window.__clipboardText = String(text);
  14  |       },
  15  |       readText: async () => window.__clipboardText,
  16  |     };
  17  |     try {
  18  |       Object.defineProperty(navigator, 'clipboard', {
  19  |         configurable: true,
  20  |         value: navigator.clipboard ? {
  21  |           ...navigator.clipboard,
  22  |           writeText: async (text) => {
  23  |             window.__clipboardText = String(text);
  24  |           },
  25  |           readText: async () => window.__clipboardText,
  26  |         } : clipboardStub,
  27  |       });
  28  |     } catch (_) {
  29  |       navigator.clipboard = clipboardStub;
  30  |     }
  31  |     localStorage.clear();
  32  |     sessionStorage.clear();
  33  |   });
  34  | }
  35  | 
  36  | // El panel del negocio usa cuatro destinos fijos en móvil (Pedidos · Métricas
  37  | // · Caja · Local). Catálogo, Promociones, Reportes, Configuración y Guía viven
  38  | // dentro de "Local". En escritorio siguen en la fila superior, así que este
  39  | // helper abre el destino sólo cuando hace falta.
  40  | export async function openBusinessSection(page, selector) {
  41  |   const target = page.locator(selector);
  42  |   if (!(await target.isVisible().catch(() => false))) {
  43  |     await page.locator('[data-business-view="local"]').click();
  44  |     await target.waitFor({ state: 'visible' });
  45  |   }
  46  |   await target.click();
  47  | }
  48  | 
  49  | export async function gotoDemoReset(page, target) {
> 50  |   await page.goto(target);
      |              ^ Error: page.goto: Could not connect to server
  51  |   const cleanUrl = new URL(page.url());
  52  |   if (!cleanUrl.searchParams.has('reset') && !cleanUrl.searchParams.has('demo-reset')) {
  53  |     await page.waitForLoadState('load');
  54  |     return;
  55  |   }
  56  |   cleanUrl.searchParams.delete('reset');
  57  |   cleanUrl.searchParams.delete('demo-reset');
  58  |   await page.waitForURL(cleanUrl.toString(), { waitUntil: 'load' });
  59  | }
  60  | 
  61  | export async function clickAfterScrollSettles(page, locator, options) {
  62  |   await locator.scrollIntoViewIfNeeded();
  63  |   await page.evaluate(() => new Promise((resolve) => {
  64  |     let previousX = window.scrollX;
  65  |     let previousY = window.scrollY;
  66  |     let stableFrames = 0;
  67  | 
  68  |     const inspect = () => {
  69  |       const nextX = window.scrollX;
  70  |       const nextY = window.scrollY;
  71  |       stableFrames = nextX === previousX && nextY === previousY ? stableFrames + 1 : 0;
  72  |       previousX = nextX;
  73  |       previousY = nextY;
  74  |       if (stableFrames >= 3) resolve();
  75  |       else requestAnimationFrame(inspect);
  76  |     };
  77  | 
  78  |     requestAnimationFrame(inspect);
  79  |   }));
  80  |   await locator.click(options);
  81  | }
  82  | 
  83  | export function installPageGuards(page) {
  84  |   const errors = [];
  85  |   const badResponses = [];
  86  | 
  87  |   page.on('pageerror', (error) => {
  88  |     errors.push(error);
  89  |   });
  90  | 
  91  |   page.on('console', (message) => {
  92  |     if (message.type() === 'error') {
  93  |       const text = message.text();
  94  |       if (!text.includes('Failed to load resource') && !text.includes('Service Worker')) {
  95  |         errors.push(new Error(text));
  96  |       }
  97  |     }
  98  |   });
  99  | 
  100 |   page.on('response', (response) => {
  101 |     const status = response.status();
  102 |     if (status >= 400) {
  103 |       const request = response.request();
  104 |       const url = response.url();
  105 |       const resourceType = request.resourceType();
  106 |       if (resourceType !== 'xhr' && resourceType !== 'fetch') {
  107 |         badResponses.push(`${status} ${resourceType} ${url}`);
  108 |       }
  109 |     }
  110 |   });
  111 | 
  112 |   return {
  113 |     errors,
  114 |     badResponses,
  115 |     async assertClean() {
  116 |       expect(errors, errors.map((error) => error.message)).toEqual([]);
  117 |       expect(badResponses, badResponses.join('\n')).toEqual([]);
  118 |     },
  119 |   };
  120 | }
  121 | 
  122 | export async function waitForToast(page, text) {
  123 |   await expect(page.locator('[data-toast]')).toContainText(text);
  124 | }
  125 | 
  126 | // ===== Arnés del checkout basado en Perfil =====
  127 | // El checkout dejó de tener inputs de cliente y dirección: esos datos son
  128 | // autoridad exclusiva del Perfil. El arnés siembra un Perfil sandbox sintético
  129 | // y después usa la interfaz real para elegir dirección. Nunca escribe campos
  130 | // ocultos del pedido ni recrea los inputs retirados.
  131 | 
  132 | export const SANDBOX_PROFILE_STORAGE_PREFIX = 'la-taba-sandbox-profile';
  133 | 
  134 | export const DEFAULT_CHECKOUT_ADDRESSES = Object.freeze([
  135 |   { label: 'Casa', street: 'Avenida Argentina', streetNumber: '450', city: 'Neuquén Capital', reference: 'Portón negro, timbre 2' },
  136 |   { label: 'Trabajo', street: 'Julio Argentino Roca', streetNumber: '1220', city: 'Neuquén Capital', reference: 'Oficina 4B' },
  137 |   { label: 'Casa de mamá', street: 'Diagonal 9 de Julio', streetNumber: '87', city: 'Neuquén Capital', reference: '' },
  138 |   { label: 'Depto centro', street: 'General Manuel Belgrano', streetNumber: '333', city: 'Neuquén Capital', reference: '' },
  139 | ]);
  140 | 
  141 | const EXTRA_CHECKOUT_ADDRESSES = Object.freeze([
  142 |   { label: 'Quinta', street: 'Antártida Argentina', streetNumber: '2140', city: 'Neuquén Capital' },
  143 |   { label: 'Estudio', street: 'Avenida Olascoaga', streetNumber: '755', city: 'Neuquén Capital' },
  144 |   { label: 'Cabaña', street: 'Río Limay', streetNumber: '64', city: 'Neuquén Capital' },
  145 |   { label: 'Depósito', street: 'Doctor Ramón', streetNumber: '1890', city: 'Neuquén Capital' },
  146 |   { label: 'Casa de Ana', street: 'Independencia', streetNumber: '512', city: 'Neuquén Capital' },
  147 |   { label: 'Consultorio', street: 'Santa Fe', streetNumber: '145', city: 'Neuquén Capital' },
  148 | ]);
  149 | 
  150 | export function buildCheckoutAddresses(count, namespace = 'demo') {
```