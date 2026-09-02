/**
 * Acepta variables pasadas como argumento: `npm run seed:prueba FOO=bar`.
 *
 * Existe por una razón concreta: el repo se opera desde PowerShell, y el
 * prefijo de bash `FOO=bar comando` ahí no significa nada — npm lo reenvía al
 * script como un argumento suelto y la variable nunca llega. El error que sale
 * ("falta FOO") no da ninguna pista de que el problema es el shell.
 *
 * La alternativa nativa, `$env:FOO="bar"; npm run ...`, funciona pero deja la
 * variable colgada en la sesión. Para una contraseña eso no es ideal.
 *
 * Los argumentos GANAN sobre el entorno y sobre `.env.local`: si alguien se
 * toma el trabajo de escribirlo en la línea de comandos, es lo que quiso decir.
 *
 * Se llama DESPUÉS de `dotenv.config()` y ANTES de importar `src/db`, que lee
 * `DATABASE_URL` al evaluarse.
 */
export function leerArgsComoEnv(argv: string[] = process.argv.slice(2)): void {
  for (const arg of argv) {
    // Solo `CLAVE=valor` con forma de variable de entorno. Un argumento que no
    // matchee se ignora en silencio en vez de romper: puede ser una flag de
    // otra cosa, y fallar acá sería peor que no hacer nada.
    // `[\s\S]` y no la flag `s`: el target de TS del repo es anterior a es2018.
    const m = /^([A-Z][A-Z0-9_]*)=([\s\S]*)$/.exec(arg);
    if (m) process.env[m[1]] = m[2];
  }
}
