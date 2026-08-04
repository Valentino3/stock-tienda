import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Scratch de plugins, no es código del proyecto.
    ".remember/**",
  ]),
  {
    rules: {
      // `any` en la capa de dominio es una decisión tomada y documentada, no
      // un descuido: todas las funciones de src/domain/* reciben `db: any` /
      // `tx: any` porque tipar exacto el drizzle de Neon y el de PGlite a la
      // vez es una pelea de genéricos que no paga (ver el comentario en
      // src/db/index.ts). El comportamiento lo cubren los tests, que corren
      // contra los dos drivers.
      //
      // Queda como warning y no apagada: en código nuevo que NO sea un
      // parámetro de base, un `any` sigue siendo algo para mirar.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
]);

export default eslintConfig;
