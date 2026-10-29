// Precarga de cada archivo de `node --test` (scripts/test.mjs y `npm run test:paridad`): arma electron/aislar.ts en el
// archivo. Así un acceso al home de la persona (escribir su lideres.json, leer ~/.claude, lanzar un binario de ~/.local/bin)
// queda anotado en stderr y el archivo sale con 97: falla. Lo permitido es el checkout (HILOS_AISLAR_PERMITE lo arma
// scripts/test.mjs). tests/aislar.test.ts comprueba que este cable existe.
process.env.TRAMA_AISLAR ??= "1";
await import("../electron/aislar.ts");
