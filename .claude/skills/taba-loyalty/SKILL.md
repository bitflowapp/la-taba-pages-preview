---
name: taba-loyalty
description: Diseño de fidelización de TABA2 — "Taba Puntos", beneficios por cliente frecuente, canjes y saldos. Usar cuando se pida sumar o descontar puntos, mostrar un saldo, crear un programa de fidelidad, premiar recompras, o revisar un diseño de recompensas. El programa NO está construido: esta skill dice cómo hacerlo bien y qué rechazar mientras tanto.
allowed-tools: Read, Grep, Glob
---

# Taba Puntos · principios de diseño

**Estado: no construido.** Hoy no existe programa de puntos, ni saldo, ni canje.
Lo único que hay es un contador local de pedidos que sugiere al comercio revisar
si corresponde reconocer a un cliente frecuente: no otorga nada, no acumula nada
y no promete nada. Ver
[references/ledger-de-puntos.md](references/ledger-de-puntos.md).

Esta skill existe para dos cosas: **rechazar bien** lo que hoy no corresponde
hacer, y que el día que se construya, se construya derecho.

## El error que define todo el diseño

Un punto es dinero con otro nombre. Todo lo que se rechazaría en un sistema de
pagos se rechaza acá.

**El cliente nunca es autoridad sobre su saldo.** Un pedido de "dale 500 puntos
desde el frontend" se rechaza sin negociar: no importa si es para probar, si es
temporal o si el botón queda oculto. Un saldo que el navegador puede escribir es
un saldo que cualquiera puede escribir, y en el momento en que ese número se
canjea por producto, la pérdida es real.

Lo mismo aplica a: calcular el saldo en el cliente y mandarlo al servidor,
confiar en un total de puntos que viene en el payload, o exponer una función que
acredite puntos sin verificar quién llama.

## Los siete principios

1. **Ledger server-side.** El saldo no es una columna que se edita: es la suma de
   un libro de asientos inmutable. Cada asiento dice cuánto, por qué, sobre qué
   pedido, quién lo originó y cuándo. Un saldo sin asientos que lo expliquen no
   es auditable.
2. **Puntos sólo después de `delivered`.** No al crear el pedido, no al pagar, no
   al despachar. Entregado. Cualquier estado anterior puede revertirse, y un
   punto acreditado antes de tiempo se canjea antes de que la reversión llegue.
3. **Devolución o reversión revierte los puntos.** Con un asiento **nuevo** de
   signo contrario, referenciando el original. Nunca borrando ni editando el
   asiento anterior: el historial es evidencia.
4. **El cliente nunca es autoridad.** El navegador muestra el saldo que le dijo
   el servidor. Puede estar desactualizado; no puede estar equivocado a favor.
5. **Historial auditable.** La persona puede ver de dónde salió cada punto y en
   qué se fue. Un programa que no se puede explicar al cliente que reclama, no se
   puede defender.
6. **Reglas versionadas.** La regla que aplicó a un pedido queda registrada con
   ese pedido. Cambiar la tasa mañana no puede reescribir lo que se acreditó
   ayer.
7. **Las promociones no viven en el ledger.** Un descuento es un descuento y lo
   gobierna `taba-pricing-promotions`. Mezclarlos hace imposible responder
   cuánto costó el programa.

## Lo que hay que decidir antes de escribir una línea

Ninguna de estas preguntas la puede contestar un agente:

- ¿Cuánto vale un punto, y contra qué se canjea?
- ¿Vencen? ¿Cuándo, y cómo se avisa?
- ¿Acreditan los pedidos con alcohol? (hay una decisión legal detrás)
- ¿Qué pasa con una entrega parcial o un ítem devuelto?
- ¿El saldo es por persona o por teléfono? ¿Qué pasa si cambia el teléfono?
- ¿Quién absorbe el costo del beneficio, y con qué tope mensual?

Sin estas respuestas, el diseño técnico no se puede cerrar. Escribirlo igual
produce un sistema que hay que migrar en cuanto el dueño opine.

## Qué responder mientras el programa no exista

1. Decir que no existe, sin rodeos.
2. Ofrecer lo que sí se puede hoy: reconocer al cliente frecuente para que **una
   persona** decida el gesto.
3. Si el pedido implica acreditar, descontar o mostrar un saldo: rechazar y
   explicar por qué, apuntando a los principios de arriba.
4. Nunca dibujar un saldo de mentira "para ver cómo queda". Una maqueta con un
   número de puntos se convierte en expectativa en cuanto alguien la muestra.

## Nunca

- Acreditar, descontar o calcular puntos desde el cliente.
- Acreditar antes de la entrega.
- Corregir un saldo editando o borrando asientos.
- Prometer un beneficio que el comercio no aprobó.
- Implementar el programa como parte de otra tarea. Loyalty es una fase con su
  propio gate.
