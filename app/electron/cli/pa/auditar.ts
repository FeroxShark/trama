// `pa <proyecto> --auditar <id|rama> [--decisiones F]` y `pa <proyecto> --actualizar <id>`: lo que arman antes de lanzar (port de
// motor/bin/pa). Las dos son corridas: acá está su validación (los `exit 2`), la tarea fija y la línea de contrato de --actualizar;
// el lanzamiento en sí es el de cualquier corrida (--auditar es una --leer nueva; --actualizar, una limpia en el puesto y la rama
// de esa corrida, con `origen=<id>`). También `verificacion_de` / `verificado_de` (la sección VERIFICACION de un RESULTADO).
import { existsSync, readFileSync, statSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { existeRama, gs, leerCampo, type Proy } from "./ramas-base.ts";

const ENCABEZADO_V = /^[*#> \t-]*VERIFICACI[^:*]{1,2}N[*]*:[*]*(.*)$/iu;
const OTRO_ENCABEZADO = /^[*#> \t-]*(RESULTADO|ARCHIVOS|DECISI[^:*]{1,2}N|SIGUE|PROBAR|PREGUNTA|FREN(O|Ó))[*]*:/iu;

/** `verificacion_de`: el texto de la sección VERIFICACION (hasta el próximo encabezado), sin los `\n` del final. "" si no está. */
export function verificacionDe(texto: string): string {
  const ls = texto.split("\n");
  if (ls.at(-1) === "") ls.pop(); // `read` no ve una línea vacía después del último `\n`
  let en = false;
  let t = "";
  for (const l of ls) {
    if (!en) {
      const m = ENCABEZADO_V.exec(l);
      if (m) {
        en = true;
        t = m[1] ?? "";
      }
      continue;
    }
    if (OTRO_ENCABEZADO.test(l)) break;
    t += "\n" + l;
  }
  return t.replace(/\n+$/, "");
}

/** `verificado_de`: ¿el RESULTADO trae evidencia? (falta, vacía o «ninguna» = no). */
export function verificadoDe(texto: string): boolean {
  const t = verificacionDe(texto).replace(/[`*_]/g, "").replace(/\s/g, " ").trim();
  if (!t) return false;
  return !/^(ninguna|ninguno|nada|n\/?a|no|-+|sin\s+verificar)([\s.:,;-]|$)/i.test(t);
}

type Error2 = { ok: false; codigo: number; mensaje: string };
const error2 = (mensaje: string): Error2 => ({ ok: false, codigo: 2, mensaje });

/** Las combinaciones que el bash rechaza al parsear (antes de la política de modelos). null si van. */
export function validarCombinaciones(o: {
  auditar?: string;
  decisiones?: string;
  seguir?: boolean;
  aca?: boolean;
  actualizar?: string;
  integrar?: string;
  descartar?: string;
  tests?: boolean;
}): string | null {
  if (o.tests && !o.integrar) return "pa: --tests va con --integrar: pa <proy> --integrar <id> --tests\n";
  if (o.auditar && (o.seguir || o.aca || o.actualizar || o.integrar || o.descartar))
    return "pa: --auditar no va con --seguir, --aca, --actualizar, --integrar ni --descartar: es una corrida --leer nueva.\n";
  if (o.decisiones && !o.auditar) return "pa: --decisiones sólo va con --auditar (lo lee el auditor).\n";
  return null;
}

const jqResult = (json: string): string => {
  try {
    const r = (JSON.parse(readFileSync(json, "utf8")) as { result?: unknown } | null)?.result;
    return r === undefined || r === null || r === false ? "" : typeof r === "string" ? r : JSON.stringify(r);
  } catch {
    return "";
  }
};
const noVacio = (f: string) => {
  try {
    return statSync(f).size > 0;
  } catch {
    return false;
  }
};

/** La tarea de una auditoría (`--auditar`), o el error (exit 2) si no hay esa corrida/rama o no se puede leer --decisiones. */
export async function prepararAuditar(x: Proy, auditar: string, decisiones: string, pedido: string): Promise<{ ok: true; tarea: string; rama: string } | Error2> {
  let rama = "";
  let wt = "";
  let prev = "";
  const corrida = path.join(x.dir, `${auditar}.corrida`);
  const hilo = path.join(x.dir, `${auditar}.hilo`);
  if (existsSync(corrida) || existsSync(hilo)) {
    for (const f of [corrida, hilo]) {
      if (!rama && existsSync(f)) rama = leerCampo(f, "rama");
      if (!wt && existsSync(f)) wt = leerCampo(f, "ruta_trabajo");
    }
    const json = path.join(x.dir, `${auditar}.json`);
    if (noVacio(json)) prev = verificacionDe(jqResult(json) + "\n");
  } else rama = auditar;
  if (!rama || !(await existeRama(x, x.ruta, rama)))
    return error2(`pa: --auditar '${auditar}': no encuentro esa corrida ni esa rama en '${x.slug}' (¿integrada o descartada? mirá pa '${x.proyecto}' --ramas).\n`);
  const base = (await gs(x, x.ruta, ["rev-parse", "--abbrev-ref", "HEAD"])) || "main";
  let dec = "";
  if (decisiones) {
    try {
      if (!statSync(decisiones).isFile()) throw new Error("no es archivo");
      dec = readFileSync(decisiones, "utf8").replace(/\n+$/, "");
    } catch {
      return error2(`pa: --decisiones '${decisiones}': no existe o no se puede leer.\n`);
    }
  }
  const r = x.ruta;
  const tarea =
    `AUDITORÍA de la rama ${rama} (sólo lectura: no modificás nada).\n` +
    "Qué hacer:\n" +
    `1) Mirá qué cambió: \`git -C ${r} diff --stat ${base}...${rama}\`, \`git -C ${r} log --oneline ${base}..${rama}\` y el diff completo con \`git -C ${r} diff ${base}...${rama}\` (por archivo si es largo). ${wt ? `Los archivos completos de la rama están en ${wt} (leelos con Read).` : ""}\n` +
    "2) Leé el contexto que haga falta del código vecino para juzgar si el cambio es correcto, no sólo si compila.\n" +
    `3) Verificación: el modo lectura NO te deja correr tests ni builds. Revisá la evidencia que dejó el autor y decí si alcanza y si calza con el diff${prev ? `. El autor declaró:\n${prev}` : ""}\n` +
    `4) Buscá, por orden: bugs y casos borde sin cubrir, regresiones en lo que el diff toca, tests que faltan o que no prueban lo que dicen, seguridad, y recién al final estilo.${dec ? `\n\nDecisiones tomadas a propósito (no las marques como error):\n${dec}` : ""}\n` +
    'Respondé con el bloque de siempre. En RESULTADO: el veredicto en una oración ("sin problemas", "hay que arreglar X" o "no integrar") y los problemas ordenados por severidad, una línea cada uno: CRITICO / ALTO / MEDIO / BAJO, `archivo:línea`, qué pasa y cómo arreglarlo. VERIFICACION: qué comprobaste vos (los comandos git que corriste y qué viste) y, si la verificación del autor no alcanza, el comando exacto que el jefe debería correr. DECISION: nada, salvo que haya que decidir algo de rumbo.' +
    (pedido ? `\nPedido del jefe: ${pedido}` : "");
  return { ok: true, tarea, rama };
}

/** La validación de `--actualizar <id>` (exit 2 si no va). Devuelve la `.corrida` y su rama. */
export async function validarActualizar(
  x: Proy,
  id: string,
  o: { seguir?: boolean; leer?: boolean; aca?: boolean } = {},
): Promise<{ ok: true; corrida: string; rama: string } | Error2> {
  if (o.seguir || o.leer || o.aca) return error2("pa: --actualizar no va con --seguir, --leer ni --aca: es una corrida limpia sobre la rama de esa corrida.\n");
  const c = path.join(x.dir, `${id}.corrida`);
  const rama = existsSync(c) ? leerCampo(c, "rama") : "";
  if (!rama) return error2(`pa: no hay una corrida '${id}' de '${x.slug}' con rama propia (falta ${c} o corrió en el tree principal).\n`);
  if (!(await existeRama(x, x.ruta, rama))) return error2(`pa: la rama ${rama} ya no existe (¿integrada o descartada?).\n`);
  return { ok: true, corrida: c, rama };
}

/** La tarea fija de `--actualizar`: rebasear `rama` sobre el HEAD del tree principal. `base` es la de la corrida (la de su puesto). */
export function tareaActualizar(o: { rama: string; base: string; shaMain: string; ramaMain: string; extra?: string }): string {
  const { rama, base, shaMain, ramaMain } = o;
  let t =
    `Actualizá tu rama ${rama}: rebaseala sobre ${shaMain} (el HEAD actual de ${ramaMain} del tree principal) con \`git rebase ${shaMain}\`.\n` +
    `Mientras tanto entraron a ${ramaMain} cambios de otros workers que tocan lo mismo que vos, y el jefe no pudo integrarla sin conflictos.\n` +
    `Si el rebase choca: mirá los dos lados (lo tuyo y lo que entró: \`git log -p ${base}..${shaMain} -- <archivo>\`), resolvé ENTENDIENDO los dos cambios (no te quedes con uno solo a ciegas), \`git add <archivo>\` y \`git rebase --continue\`. Nunca \`git rebase --skip\` sobre un commit tuyo.\n` +
    "Después corré los tests del proyecto (si los hay) y arreglá lo que se haya roto. Commiteá archivo por archivo.\n" +
    "En RESULTADO decí qué conflictos hubo y cómo los resolviste. Si no pudiste, `git rebase --abort` y explicá por qué en DECISION.";
  if (o.extra) t += `\n\nContexto del jefe: ${o.extra}`;
  return t;
}

/** Lo que `--actualizar` arma con el proyecto: el HEAD del tree principal, la tarea, y la `base=` de la corrida original pasa a ser ese HEAD. */
export async function armarActualizar(x: Proy, id: string, o: { rama: string; base: string; extra?: string }): Promise<{ tarea: string; shaMain: string }> {
  const shaMain = await gs(x, x.ruta, ["rev-parse", "HEAD"]);
  const ramaMain = await gs(x, x.ruta, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const tarea = tareaActualizar({ rama: o.rama, base: o.base, shaMain, ramaMain, extra: o.extra });
  const c = path.join(x.dir, `${id}.corrida`);
  try {
    const nuevo = readFileSync(c, "utf8").replace(/^base=.*$/gm, `base=${shaMain}`);
    writeFileSync(`${c}.tmp`, nuevo);
    renameSync(`${c}.tmp`, c);
  } catch {
    /* el sed && mv del bash: si falla, sigue */
  }
  return { tarea, shaMain };
}

/** La línea de contrato de una corrida --actualizar (va después de las lecciones). */
export const contratoActualizar = (rama: string, rutaTrabajo: string, shaMain: string) =>
  `\nEstás en la rama ${rama} de un worktree propio (${rutaTrabajo}). Tu tarea es rebasearla: \`git rebase ${shaMain}\` está AUTORIZADO, igual que \`git add <archivo>\`, \`git rebase --continue\` y \`git rebase --abort\`. No cambies a otra rama, no mergees, no toques el tree principal: integra el jefe. Los editores de git están apagados (GIT_EDITOR=true): el mensaje de cada commit queda como estaba.`;
