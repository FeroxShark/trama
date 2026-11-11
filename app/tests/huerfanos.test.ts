// electron/huerfanos.ts: lo que un líder deja corriendo (aunque haga setsid, fuera de su grupo) se encuentra por la etiqueta que heredó y se
// barre al salir el líder o al arrancar un motor nuevo. Sólo Linux (lee /proc): por eso `testPosix`.
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { barrerDeMotoresMuertos, barrerEtiqueta, conEtiqueta, nuevaEtiqueta, VARIABLE } from "../electron/huerfanos.ts";

/** Un proceso hijo con la etiqueta en el entorno y en su propia sesión (setsid, como el Bash tool de un líder). */
function hijoEtiquetado(etiqueta: string): ChildProcess {
  return spawn("sleep", ["30"], { detached: true, stdio: "ignore", env: { ...process.env, [VARIABLE]: etiqueta } });
}

const salio = (p: ChildProcess) => new Promise<NodeJS.Signals | number | null>((ok) => p.once("exit", (_c, sen) => ok(sen ?? _c)));

test("una etiqueta vacía no encuentra nada", () => {
  assert.deepEqual(conEtiqueta(""), []);
});

test("el hijo con setsid se encuentra por su etiqueta y barrerEtiqueta lo termina", async () => {
  const et = nuevaEtiqueta(process.pid + 900_000, "123", "prueba1");
  const h = hijoEtiquetado(et);
  try {
    assert.ok(h.pid);
    assert.deepEqual(conEtiqueta(et), [h.pid]);
    const fin = salio(h);
    const alcanzados = barrerEtiqueta(et, { esperaMs: 60_000 });
    assert.deepEqual(alcanzados, [h.pid]);
    assert.equal(await fin, "SIGTERM");
  } finally {
    h.kill("SIGKILL");
  }
});

test("tres relanzos del motor: no queda ningún hijo de un motor muerto", async () => {
  const hijos: ChildProcess[] = [];
  const etiquetas: string[] = [];
  const muertosDePrueba = new Set<number>();
  try {
    for (let vuelta = 1; vuelta <= 3; vuelta++) {
      // Cada motor deja un líder con su `pactl subscribe` (aquí un `sleep`) en una sesión propia; el motor muere sin barrer.
      const pidMotor = process.pid + 800_000 + vuelta;
      muertosDePrueba.add(pidMotor);
      const et = nuevaEtiqueta(pidMotor, `arr${vuelta}`, `v${vuelta}`);
      etiquetas.push(et);
      hijos.push(hijoEtiquetado(et));
      // El motor nuevo arranca: los motores de mentira de esta prueba están muertos; los demás (un trama real en esta máquina) se dan por vivos.
      barrerDeMotoresMuertos((pid) => !muertosDePrueba.has(pid), { esperaMs: 60_000 });
    }
    const salidas = await Promise.all(hijos.map(salio));
    assert.equal(salidas.length, 3);
    for (const et of etiquetas) assert.deepEqual(conEtiqueta(et), []);
  } finally {
    for (const h of hijos) h.kill("SIGKILL");
  }
});

test("barrerDeMotoresMuertos no toca a los hijos de un motor vivo", async () => {
  const et = nuevaEtiqueta(process.pid + 700_000, "vivo", "vivo1");
  const h = hijoEtiquetado(et);
  try {
    const sigue = barrerDeMotoresMuertos(() => true, { esperaMs: 60_000 });
    assert.deepEqual(sigue, []);
    assert.deepEqual(conEtiqueta(et), [h.pid]);
    const fin = salio(h);
    barrerEtiqueta(et, { esperaMs: 60_000 });
    await fin;
  } finally {
    h.kill("SIGKILL");
  }
});
