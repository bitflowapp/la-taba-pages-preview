/*
 * TABA — PRUEBA DE VENTA REAL, DE PUNTA A PUNTA.
 *
 * Este archivo es la puerta de entrada de siempre y hoy no hace nada por su
 * cuenta: despacha a `auto.mjs`, que es el único runner.
 *
 * POR QUÉ QUEDÓ ASÍ. Cuando la corrida pasó a ser autónoma —sesiones que se
 * renuevan solas, recepción y publicación por el Panel, un plan decidido antes
 * de tocar nada— este archivo tenía su propio precheck y su propia forma de
 * abrir navegadores. Dos runners con dos prechecks que tienen que decir lo
 * mismo son dos runners que en algún momento dicen cosas distintas, y el que
 * decide si se crea un pedido de producción no puede ser el que quedó
 * desactualizado. Hay uno solo.
 *
 * Los tres comandos siguen funcionando y significan lo mismo que antes:
 *
 *   npm run e2e:production-sale:dry     ensayo: mide, valida, no escribe nada
 *   npm run e2e:production-sale         igual, salvo que estén las cuatro llaves
 *   npm run e2e:production-sale:auto    el nombre nuevo del mismo runner
 *
 * Las cuatro llaves (tres banderas y una variable de entorno) siguen siendo lo
 * único que habilita crear un pedido real. Están en `contrato.mjs`.
 */
await import('./auto.mjs');
