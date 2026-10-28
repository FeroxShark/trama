// `pa --revertir <id>` (cmd_revertir de motor/bin/pa): deshace una integración en el tree principal con `git revert` de
// head_antes..head_despues (commits nuevos arriba; nunca reescribe historia ni fuerza nada). Mismo candado que --integrar (git + el del
// tree principal). Se niega si lo sucio del tree principal se cruza con lo que hay que revertir (89), si el revert choca con algo que
// entró después (90: lo aborta y deja todo como estaba) o si la integración no trajo commits (91).
import { existsSync } from "node:fs";
import path from "node:path";
import type { Lock } from "../base/lock.ts";
import type { Pa } from "./entorno.ts";
import { anotarIntegrada, filaIntegrada, usarId } from "./ramas.ts";
import { g, gOk, gs, lockDePuesto, rutaPorcelain, suciosDe, tomarGit, tomarLock } from "./ramas-base.ts";

const soltar = async (...ls: (Lock | null)[]) => {
  for (const l of ls) await l?.liberar();
};

export async function cmdRevertir(pa: Pa, t = ""): Promise<number> {
  const { io } = pa;
  if (!t) {
    io.err("uso: pa --revertir <id-de-corrida>\n");
    return 2;
  }
  const x = usarId(pa, t);
  const f = filaIntegrada(pa, t);
  if (!f) {
    io.err(`pa: '${t}' no está en ${path.join(pa.state, "integradas.tsv")}: nunca se integró (o fue antes de que existiera el registro).\n`);
    return 1;
  }
  const [, , , r = "", ramaPpal = "", antes = "", despues = "", n = "", , acc = ""] = f;
  if (acc === "revertida") {
    io.err(`pa: ${t} ya se revirtió.\n`);
    return 1;
  }
  if (acc === "descartada") {
    io.err(`pa: ${t} se descartó: nunca entró a main.\n`);
    return 1;
  }
  if (n === "0" || antes === despues) {
    io.err(
      `pa: la integración de ${t} no trajo commits (${r} ya estaba entera en ${ramaPpal}: la mergeó alguien a mano). No hay rango que revertir; buscá esos commits con git log.\n`,
    );
    return 91;
  }
  const lg = await tomarGit(x, 60_000);
  if (!lg) {
    io.err(`pa: el candado de git de '${x.slug}' sigue ocupado después de 60s. Reintentá.\n`);
    return 75;
  }
  const l7 = await tomarLock(x, lockDePuesto(x, "aca"));
  if (!l7) {
    await soltar(lg);
    io.err(`pa: hay un worker --aca corriendo en el tree principal de '${x.slug}'; revertir le movería los archivos abajo. Esperalo.\n`);
    return 75;
  }
  try {
    if (!(await gOk(x, x.ruta, ["merge-base", "--is-ancestor", despues, "HEAD"]))) {
      await soltar(l7, lg);
      io.err(`pa: el HEAD del tree principal de '${x.slug}' no contiene la integración de ${t} (${despues.slice(0, 7)}): ¿otra rama checkouteada? No toqué nada.\n`);
      return 1;
    }
    const tocados = new Set((await gs(x, x.ruta, ["diff", "--name-only", antes, despues])).split("\n"));
    const sucios = (await suciosDe(x, x.ruta)).filter(Boolean).map(rutaPorcelain);
    const choque = sucios.filter((s) => tocados.has(s));
    if (choque.length) {
      await soltar(l7, lg);
      io.err(`pa: NO revierto: el tree principal de '${x.slug}' tiene sin commitear archivos que el revert de ${t} toca:\n`);
      io.err(choque.map((c) => `    ${c}\n`).join(""));
      io.err("    Commitealos, movelos o tiralos, y volvé a correr --revertir. No fuerzo nada.\n");
      return 89;
    }
    const cabeza = await gs(x, x.ruta, ["rev-parse", "HEAD"]);
    const rv = await g(x, x.ruta, ["revert", "--no-edit", `${antes}..${despues}`]);
    if (rv.codigo !== 0) {
      const gd = await gs(x, x.ruta, ["rev-parse", "--absolute-git-dir"]);
      const aMedias = !!gd && (existsSync(path.join(gd, "REVERT_HEAD")) || existsSync(path.join(gd, "sequencer")));
      if (aMedias) await g(x, x.ruta, ["revert", "--abort"]);
      await soltar(l7, lg);
      if (aMedias) {
        io.err(`pa: el revert de ${t} choca con algo que entró después a ${ramaPpal} (toca lo mismo). Lo aborté: ${ramaPpal} quedó como estaba.\n`);
        io.err(`    Que lo deshaga un worker que entienda los dos cambios: pa '${x.proyecto}' 'revertí a mano lo que metió ${r}'.\n`);
        return 90;
      }
      io.err(`pa: git revert falló sin empezar (no toqué nada): ${[...rv.errores.replace(/\n+$/, "")].slice(0, 300).join("")}\n`);
      return 1;
    }
    await soltar(l7, lg);
    const nuevo = await gs(x, x.ruta, ["rev-parse", "HEAD"]);
    const cuenta = await gs(x, x.ruta, ["rev-list", "--count", `${cabeza}..${nuevo}`]);
    await anotarIntegrada(pa, {
      id: t,
      proyecto: x.slug,
      rama: r,
      ramaPpal: await gs(x, x.ruta, ["rev-parse", "--abbrev-ref", "HEAD"]),
      antes: cabeza,
      despues: nuevo,
      commits: /^[0-9]+$/.test(cuenta) ? cuenta : "0",
      accion: "revertida",
    });
    io.out(`pa: revertida ${t} en ${ramaPpal} de '${x.slug}' (${n} commit(s) deshechos con revert; la historia queda).\n`);
    return 0;
  } finally {
    await soltar(l7, lg);
  }
}
