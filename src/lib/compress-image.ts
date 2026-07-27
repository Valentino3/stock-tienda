// Compresión de fotos en el navegador, antes de subirlas.
//
// Una foto de factura sacada con el celular pesa entre 3 y 8 MB, y Vercel
// rechaza cualquier request de más de 4.5 MB (ver src/lib/import-limits.ts).
// Reescalar a 2000 px y reencodear como JPEG deja una foto de ~8 MB en ~400 KB
// sin perder legibilidad para el modelo de visión — que además cobra y tarda
// por píxel, así que comprimir también abarata y acelera la extracción.

/** Lado mayor de la imagen resultante. 2000 px alcanza para leer una factura. */
const MAX_DIMENSION = 2000;
/** Debajo de esto no vale la pena reencodear: ya entra holgado en el request. */
const SKIP_BELOW_BYTES = 1024 * 1024;
const JPEG_QUALITY = 0.82;

/**
 * Devuelve una versión comprimida de `file`, o el original si no hace falta
 * comprimir, si el navegador no soporta las APIs necesarias, o si el resultado
 * termina siendo más grande que la entrada (pasa con PNG chicos o capturas ya
 * optimizadas). Nunca lanza: ante cualquier problema devuelve el original y que
 * la guarda de tamaño decida.
 */
export async function compressImage(file: File): Promise<File> {
  if (file.size <= SKIP_BELOW_BYTES) return file;
  if (typeof createImageBitmap !== "function") return file;

  try {
    // imageOrientation: "from-image" aplica la rotación EXIF al bitmap. Sin
    // esto, las fotos verticales de celular quedan acostadas: el canvas ignora
    // el EXIF y el reencode lo descarta, así que la rotación se perdería.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}
