/**
 * La cantidad de una línea del carrito, tipeada con el teclado.
 *
 * Vive en su propio módulo, puro y sin React, por una razón concreta: la
 * cantidad multiplica al precio, así que es plata, y el repo no tiene tests de
 * componentes. Acá la lógica se puede cubrir con propiedades (ver
 * `tests/vender-cantidad.test.ts`), que es lo que AGENTS.md pide para lo que
 * suma o resta plata.
 */

/**
 * Techo para una línea que no lleva stock (un plato, un servicio): ésas no
 * tienen existencias contra las que clampear. Sin un tope, una tecla trabada
 * en el 9 arma un total que nadie deshace de casualidad. Ningún mostrador
 * vende diez mil unidades de una sola cosa.
 */
export const MAX_UNIDADES = 9999;

/**
 * Lo que se deja quedar en el campo mientras se escribe.
 *
 * Trunca en el primer carácter que no es dígito en vez de filtrar los dígitos
 * sueltos: pegar "1.5" tiene que dar "1", nunca "15". Filtrando, un punto
 * decimal pegado desde una planilla multiplica el cobro por diez, y la
 * cantidad no puede crecer nunca por culpa de un carácter que no se entendió.
 */
export function sanitizarCantidad(raw: string): string {
  const m = /^\d*/.exec(raw.trim());
  return (m ? m[0] : "").slice(0, String(MAX_UNIDADES).length);
}

/**
 * La cantidad que hay que comitear al carrito, o `null` si todavía no hay
 * ninguna.
 *
 * `null` es el caso importante: un campo vacío no es un pedido de vender cero
 * ni de vender uno, es un campo a medio escribir. Devolviendo `null` el
 * llamador deja la cantidad anterior en su lugar, y así ninguna secuencia de
 * teclas puede producir una línea inválida ni borrar la que había.
 *
 * Lo que sí se hace es clampear al tope: el campo muestra lo que el cajero
 * escribió, pero al carrito no entra más de lo que hay para vender.
 */
export function cantidadTipeada(raw: string, tope: number): number | null {
  const limpio = sanitizarCantidad(raw);
  if (limpio === "") return null;
  const n = Number(limpio);
  if (!Number.isInteger(n) || n < 1) return null;
  return Math.min(n, tope);
}
