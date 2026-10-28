// pa — el `pa` de TypeScript (dist-electron/cli/pa.js; en Windows lo busca binario.ts). Hoy cubre el CLI (etapa 5: parseo,
// validaciones, política de modelos y los subcomandos chicos); lo que todavía vive sólo en motor/bin/pa sale 70 con un aviso.
// Los ports de las etapas 6-10 se enchufan en `deps` (ver Deps en pa/cli.ts).
import { spawnSync } from "node:child_process";
import { esPrincipal } from "./base/principal.ts";
import { main, type Deps } from "./pa/cli.ts";
import type { Env } from "./pa/entorno.ts";

/** Otro `pa` igual a éste (los intentos de -m a,b,c), con la salida a la vista. */
function relanzar(argv: string[], extra: Env): number {
  const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1]!, ...argv], {
    env: { ...process.env, ...extra } as NodeJS.ProcessEnv,
    stdio: "inherit",
  });
  return r.status ?? (r.signal ? 128 + 15 : 1);
}

export const deps: Deps = {
  relanzar,
  // globales: { … }, proyecto: { lanzar, … }, auditar, motores: { … } — los suman las etapas 6-10.
};

if (esPrincipal(import.meta.url)) {
  const io = { out: (s: string) => void process.stdout.write(s), err: (s: string) => void process.stderr.write(s) };
  main(process.argv.slice(2), process.env, io, deps).then(
    (rc) => {
      process.exitCode = rc;
    },
    (e: unknown) => {
      process.stderr.write(`pa: ${(e as Error)?.stack ?? String(e)}\n`);
      process.exitCode = 1;
    },
  );
}
