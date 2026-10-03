/*
 * ¿Qué le pasa a una PWA instalada si la publicación nueva tiene UNA entrada rota?
 * cache.addAll/precargar() es todo-o-nada.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:4599/index.html';
const ctx = await chromium.launchPersistentContext('.local/perfil-roto', { headless: true });
const page = await ctx.newPage();
const errores = [];
page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text().slice(0, 160)); });

const estado = () => page.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  const nombres = await caches.keys();
  return {
    caches: nombres,
    esperando: !!r?.waiting,
    instalando: !!r?.installing,
    banner: !document.querySelector('[data-app-update-banner]')?.hidden,
    cssQueVeElDocumento: [...document.styleSheets].map((s) => (s.href || '').split('/').pop()).filter(Boolean),
  };
});

fs.rmSync('.local/PUBLICACION', { force: true });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 30000 });
await page.waitForTimeout(3500);
console.log('1) instalado v85:', JSON.stringify(await estado()));

// publicacion "nueva" con UNA entrada del precache que devuelve 404
fs.writeFileSync('.local/PUBLICACION', 'v86');
fs.writeFileSync('.local/ROTO', '1');
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(9000);
const e = await estado();
console.log('2) tras publicar v86 con 1 entrada rota:', JSON.stringify(e, null, 1));
console.log('   => ¿el cliente ve el aviso de actualizacion?', e.banner);
console.log('   => caches presentes:', e.caches.join(' | '));
console.log('   => errores de consola:', errores.length ? errores.slice(0, 4) : 'NINGUNO (falla muda)');
await ctx.close();
