// Despacho provisorio de los subcomandos de la etapa 9 (ver `main` en ramas.ts): parsea sólo lo que hace falta para
// `--ramas`, `--integrar`, `--descartar`, las lecciones y las validaciones de `--actualizar` / `--auditar`, en el mismo orden que
// motor/bin/pa. Cuando esté el parseo completo de `pa` (etapa 5) esto se borra y el `pa` de TS llama directo a los cmd*.
import { resolverProyecto } from "../proyecto-ruta.ts";
import { validarActualizar, prepararAuditar, validarCombinaciones } from "./auditar.ts";
import type { Pa } from "./entorno.ts";
import { cmdLeccion, cmdLecciones, cmdLeccionesPodar } from "./lecciones.ts";
import { fijarProyecto } from "./ramas-base.ts";
import { cmdDescartar, cmdDescartarId, cmdIntegrar, cmdRamas } from "./ramas.ts";

/** Los flags que llevan valor (`flags_con_valor` del bash). */
const CON_VALOR = new Set(
  "--max-turns --id --integrar --descartar --actualizar --nota --max-budget-usd -m --model --effort --tipo --fase --tarea --subtarea --rubrica --cuenta --brief-archivo --leccion --auditar --decisiones --espejo --test-inline".split(
    " ",
  ),
);
/** Los que existen en el bash pero no pasan por acá todavía. */
const SIN_PORTAR = new Set([...CON_VALOR, "--nuevo", "--agents-md", "--unificar-md", "--aplicar", "--olvidar", "--matar", "--mcp", "--async", "--sucio-mio", "--force", "--ok-dueno"]);

export const NO_PORTADO = 70;

export async function gestion(pa: Pa, argv: string[]): Promise<number> {
  const { io } = pa;
  if (argv[0] === "--descartar") return cmdDescartarId(pa, argv[1]);
  if (argv.length < 1) {
    io.err('uso: pa <proyecto> "<tarea>"  |  pa --estado  |  pa --esperar <proyecto>\n');
    return 2;
  }
  const proyecto = argv[0]!;
  const f = { leer: false, seguir: false, aca: false, tests: false, ramas: false, lecciones: false, podar: false };
  let integrar = "";
  let descartar = "";
  let actualizar = "";
  let auditar = "";
  let decisiones = "";
  let leccion = "";
  let tarea = "";
  const a = argv.slice(1);
  for (let i = 0; i < a.length; ) {
    const x = a[i]!;
    if (CON_VALOR.has(x) && a.length - i < 2) {
      io.err(`pa: ${x} quiere un valor (ej: pa <proyecto> ${x} <valor> "<tarea>"). Mirá pa --help.\n`);
      return 2;
    }
    const val = a[i + 1] ?? "";
    switch (x) {
      case "--leer": f.leer = true; i++; continue;
      case "--seguir": f.seguir = true; i++; continue;
      case "--aca": f.aca = true; i++; continue;
      case "--sin-jefe": i++; continue;
      case "--tests": f.tests = true; i++; continue;
      case "--ramas": f.ramas = true; i++; continue;
      case "--lecciones": f.lecciones = true; i++; continue;
      case "--lecciones-podar": f.podar = true; i++; continue;
      case "--integrar": integrar = val; i += 2; continue;
      case "--descartar": descartar = val; i += 2; continue;
      case "--actualizar": actualizar = val; i += 2; continue;
      case "--auditar": auditar = val; f.leer = true; i += 2; continue;
      case "--decisiones": decisiones = val; i += 2; continue;
      case "--leccion": leccion = val; i += 2; continue;
      case "-m":
      case "--model":
        i += 2;
        continue;
      case "--effort":
        if (!/^(low|medium|high|xhigh|max)$/i.test(val)) {
          io.err(`pa: --effort '${val}' no va. Válidos: low, medium, high, xhigh, max.\n`);
          return 2;
        }
        i += 2;
        continue;
      case "--":
        tarea = a.slice(i + 1).join(" ");
        i = a.length;
        continue;
    }
    if (x.startsWith("-")) {
      if (SIN_PORTAR.has(x)) {
        io.err(`pa (TS): ${x} todavía no está portado; usá el pa de bash.\n`);
        return NO_PORTADO;
      }
      io.err(`pa: opción desconocida: ${x}\n`);
      return 2;
    }
    tarea = a.slice(i).join(" ");
    break;
  }
  const comb = validarCombinaciones({ auditar, decisiones, seguir: f.seguir, aca: f.aca, actualizar, integrar, descartar, tests: f.tests });
  if (comb) {
    io.err(comb);
    return 2;
  }
  const lanza = !(f.ramas || f.lecciones || f.podar || leccion || integrar || descartar);
  if (lanza && !auditar && !actualizar) {
    io.err("pa (TS): lanzar todavía no está portado; usá el pa de bash.\n");
    return NO_PORTADO;
  }

  const r = resolverProyecto(proyecto, pa.env);
  if (!r.ok) {
    io.err(r.mensaje);
    return r.codigo;
  }
  const x = fijarProyecto(pa, proyecto, r.ruta);

  if (integrar) return cmdIntegrar(x, integrar, { tests: f.tests });
  if (descartar) return cmdDescartar(x, descartar);
  if (f.ramas) return cmdRamas(x);
  if (leccion) return cmdLeccion(x, leccion);
  if (f.lecciones) return cmdLecciones(x);
  if (f.podar) return cmdLeccionesPodar(x);

  if (actualizar) {
    const v = await validarActualizar(x, actualizar, f);
    if (!v.ok) {
      io.err(v.mensaje);
      return v.codigo;
    }
  } else if (auditar) {
    const p = await prepararAuditar(x, auditar, decisiones, tarea);
    if (!p.ok) {
      io.err(p.mensaje);
      return p.codigo;
    }
  }
  io.err("pa (TS): lanzar todavía no está portado; usá el pa de bash.\n");
  return NO_PORTADO;
}
