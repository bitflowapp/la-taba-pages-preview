/**
 * Dígito verificador del CUIT (módulo 11).
 *
 * No es una regla del manual WSFEv1 —ARCA valida el CUIT contra el padrón, no
 * contra su dígito— pero un CUIT cuyo dígito no cierra no es un CUIT: es un
 * error de tipeo. Verificarlo acá lo detiene en la configuración fiscal, y no
 * a mitad de camino con un certificado ya emitido para el CUIT equivocado.
 */
const WEIGHTS = Object.freeze([5, 4, 3, 2, 7, 6, 5, 4, 3, 2]);

export function isValidCuit(value: string): boolean {
  if (!/^\d{11}$/.test(value)) return false;
  let sum = 0;
  for (let index = 0; index < 10; index += 1) sum += Number(value[index]) * WEIGHTS[index]!;
  const remainder = sum % 11;
  const expected = remainder === 0 ? 0 : remainder === 1 ? 9 : 11 - remainder;
  return expected === Number(value[10]);
}

export function assertValidCuit(value: string, label = 'CUIT'): void {
  if (!/^\d{11}$/.test(value)) throw new Error(`${label} inválido: son once dígitos, sin guiones.`);
  if (!isValidCuit(value)) throw new Error(`${label} inválido: el dígito verificador no cierra.`);
}
