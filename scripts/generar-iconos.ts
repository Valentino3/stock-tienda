import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Genera los íconos PNG de la PWA.
 *
 * ¿Por qué a mano y no con sharp o un exportador de SVG? Porque el ícono son
 * cuatro rectángulos: agregar una dependencia nativa de imágenes al proyecto
 * para esto sería caro y frágil, y el resultado es idéntico. El SVG sigue
 * siendo la fuente para pantallas que lo soportan; estos PNG existen porque
 * iOS no acepta SVG como apple-touch-icon y algunos launchers de Android
 * tampoco.
 *
 * Correr con: npx tsx scripts/generar-iconos.ts
 */

type RGBA = [number, number, number, number];

const MARCA: RGBA = [0x3b, 0x5b, 0xd6, 0xff];
const BLANCO: RGBA = [0xff, 0xff, 0xff, 0xff];
const TRANSPARENTE: RGBA = [0, 0, 0, 0];

class Lienzo {
  private datos: Uint8Array;
  constructor(readonly lado: number) {
    this.datos = new Uint8Array(lado * lado * 4);
  }

  pintar(x: number, y: number, c: RGBA) {
    if (x < 0 || y < 0 || x >= this.lado || y >= this.lado) return;
    const i = (y * this.lado + x) * 4;
    this.datos[i] = c[0]; this.datos[i + 1] = c[1]; this.datos[i + 2] = c[2]; this.datos[i + 3] = c[3];
  }

  /** Rectángulo con esquinas redondeadas. r = 0 da un rectángulo común. */
  rect(x0: number, y0: number, ancho: number, alto: number, r: number, c: RGBA) {
    for (let y = y0; y < y0 + alto; y++) {
      for (let x = x0; x < x0 + ancho; x++) {
        if (r > 0) {
          const dx = Math.min(x - x0, x0 + ancho - 1 - x);
          const dy = Math.min(y - y0, y0 + alto - 1 - y);
          if (dx < r && dy < r) {
            const dist = Math.hypot(r - dx, r - dy);
            if (dist > r) continue;
          }
        }
        this.pintar(x, y, c);
      }
    }
  }

  /** Semicírculos del toldo: tres paños sobre una banda. */
  panos(x0: number, y0: number, ancho: number, alto: number, cantidad: number, c: RGBA) {
    const paso = ancho / cantidad;
    const radio = paso / 2;
    for (let y = y0; y < y0 + alto + radio; y++) {
      for (let x = x0; x < x0 + ancho; x++) {
        if (y < y0 + alto) { this.pintar(x, y, c); continue; }
        const centro = x0 + (Math.floor((x - x0) / paso) + 0.5) * paso;
        if (Math.hypot(x - centro, y - (y0 + alto)) <= radio) this.pintar(x, y, c);
      }
    }
  }

  png(): Buffer {
    // Filtro 0 (None) por fila: el ícono es plano y comprime bien igual.
    const crudo = Buffer.alloc((this.lado * 4 + 1) * this.lado);
    for (let y = 0; y < this.lado; y++) {
      const base = y * (this.lado * 4 + 1);
      crudo[base] = 0;
      Buffer.from(this.datos.buffer, y * this.lado * 4, this.lado * 4).copy(crudo, base + 1);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.lado, 0);
    ihdr.writeUInt32BE(this.lado, 4);
    ihdr[8] = 8;  // profundidad de bits
    ihdr[9] = 6;  // color type 6 = RGBA
    // 10-12: compresión, filtro e interlace, todos 0.

    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(crudo, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

function chunk(tipo: string, datos: Buffer): Buffer {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length, 0);
  const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo), 0);
  return Buffer.concat([largo, cuerpo, crc]);
}

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = TABLA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param maskable el sistema recorta hasta un 20% de cada borde, así que el
 *   fondo llega a los bordes y el dibujo se encoge a la zona segura.
 */
function dibujar(lado: number, maskable: boolean): Buffer {
  const l = new Lienzo(lado);

  // El diseño está definido sobre una grilla de 512, igual que public/icono.svg.
  const s = lado / 512;
  const k = maskable ? 0.66 : 1; // encogido hacia el centro para la zona segura
  const co = (n: number) => Math.round((256 + (n - 256) * k) * s); // coordenada
  const la = (n: number) => Math.round(n * k * s); // largo

  if (maskable) {
    l.rect(0, 0, lado, lado, 0, MARCA);
  } else {
    l.rect(0, 0, lado, lado, 0, TRANSPARENTE);
    l.rect(0, 0, lado, lado, Math.round(112 * s), MARCA);
  }

  l.panos(co(128), co(176), la(256), la(40), 3, BLANCO);
  l.rect(co(160), co(288), la(192), la(128), la(16), BLANCO);
  l.rect(co(216), co(328), la(80), la(88), la(8), MARCA);

  return l.png();
}

const salida = path.resolve(import.meta.dirname, "../public");
const archivos: [string, number, boolean][] = [
  ["icono-192.png", 192, false],
  ["icono-512.png", 512, false],
  ["icono-maskable-512.png", 512, true],
  // apple-touch-icon: iOS no respeta transparencia ni redondea, así que va el
  // maskable (fondo pleno) en el tamaño que pide.
  ["apple-icon.png", 180, true],
];

for (const [nombre, lado, maskable] of archivos) {
  writeFileSync(path.join(salida, nombre), dibujar(lado, maskable));
  console.log(`${nombre} (${lado}×${lado})`);
}
