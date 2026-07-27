// Límites de subida del import. Compartidos por el cliente (guarda antes de
// subir, para dar un mensaje útil) y por los route handlers (defensa en
// profundidad: los endpoints son alcanzables sin pasar por la UI).
//
// El techo real NO es nuestro: Vercel rechaza cualquier request con body mayor
// a 4.5 MB con 413 FUNCTION_PAYLOAD_TOO_LARGE, en todos los planes, antes de
// que el código de la app llegue a ejecutarse. Dejamos 4 MB de tope propio para
// tener margen sobre el overhead del multipart.
// https://vercel.com/docs/functions/limitations#request-body-size
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Peso legible para mensajes de error: 7_549_747 -> "7,2 MB". */
export function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export type UploadKind = "pdf" | "image" | "xlsx";

/**
 * Mensaje para un archivo que excede el tope. Cada tipo tiene una salida
 * distinta, así que el texto dice qué hacer en vez de solo "muy grande".
 * `bytes` es el peso final (ya comprimido, en el caso de las imágenes).
 */
export function tooLargeMessage(kind: UploadKind, bytes: number): string {
  const size = megabytes(bytes);
  const max = megabytes(MAX_UPLOAD_BYTES);
  switch (kind) {
    case "pdf":
      return `Este PDF pesa ${size} y el máximo es ${max}. Sacá una foto de la factura (se comprime sola) o exportá el PDF en menor calidad.`;
    case "image":
      return `La imagen sigue pesando ${size} después de comprimirla y el máximo es ${max}. Probá con una foto de menor resolución.`;
    case "xlsx":
      return `La planilla pesa ${size} y el máximo es ${max}. Dividila en varios archivos.`;
  }
}
