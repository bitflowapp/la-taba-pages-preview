// Evalúa una expresión en la pestaña del Moto: node moto-eval.mjs "<js>"
import { connect } from './moto.mjs';
const { browser, page } = await connect();
const result = await page.evaluate(process.argv[2]);
console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
await browser.close();
