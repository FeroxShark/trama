// Un worker inventado con un paso de cada tipo, para capturas y pruebas sin un transcript de verdad
// (ids, rutas y tareas inventados: el repo es público). Lo usa `fuente` con fixtures, para cualquier id.
import type { Detalle, Paso, TipoPaso, VistaPasos } from "./pasos";

const T0 = Date.parse("2026-03-10T12:00:00Z");
const corto = (t: string) => ({ t, total: t.length, recortado: false });
// Textos de la variante `largo` (más de 200 caracteres): inventados.
const PROMPT_LARGO = "Buscá dónde se usa usarCuenta en todo el repo, también en los tests y en los scripts de prueba, y decime archivo por archivo la línea donde aparece y qué hace allí.";
const RESULTADO_LARGO = "RESULTADO: arreglé usarCuenta para que cuente bien en todos los casos del módulo de cuentas: el conteo empieza en 1, la pantalla lo muestra junto con los demás totales y los tests del archivo viejo siguen pasando sin cambios. Supuestos: el conteo empieza en 1; no toqué los tests viejos.\nARCHIVOS: src/cuenta.ts, src/contar.ts";

let n = 0;
function paso(tipo: TipoPaso, titulo: string, seg: number, dur: number | null, detalle: Detalle, mas: Partial<Paso> = {}): Paso {
  const i = n++;
  return { n: i, v: i + 1, id: `toolu_demo_${i}`, tipo, titulo, t: T0 + seg * 1000, dur: dur === null ? null : dur * 1000, estado: "ok", error: null, detalle, ...mas };
}

/** `vivo`: el mismo worker a mitad de camino, con `npm test` corriendo y sin mensaje final. `grandes` (`HILOS_VARIANTE=largo`): el resultado y el prompt de `delegar` pasan de 200 caracteres, para ver el pliegue con "Ver todo". */
export function pasosFijos(id: string, vivo = false, grandes = false): VistaPasos {
  n = 0;
  const sub = [
    paso("buscar", "usarCuenta", 41, 1, { clase: "buscar", herramienta: "Grep", patron: "usarCuenta", ruta: "src", resultados: 3, texto: corto("src/cuenta.ts\nsrc/pantalla.ts\nsrc/pantalla.test.ts") }),
    paso("leer", "src/cuenta.ts", 42, 1, { clase: "leer", ruta: "src/cuenta.ts", desde: 1, lineas: 3, total: 3, imagen: false, texto: corto("export function usarCuenta() {\n  return 1;\n}") }),
  ];
  const largo = Array.from({ length: 400 }, (_, i) => `línea ${i} de una salida larga`).join("\n");
  const pasos: Paso[] = [
    paso("pensar", "", 3, 3, { clase: "pensar" }),
    paso("leer", "src/cuenta.ts", 4, 1, { clase: "leer", ruta: "src/cuenta.ts", desde: 1, lineas: 3, total: 3, imagen: false, texto: corto("export function usarCuenta() {\n  return 1;\n}") }),
    paso("buscar", "TODO", 6, 2, { clase: "buscar", herramienta: "Grep", patron: "TODO", ruta: null, resultados: 0, texto: corto("No files found") }),
    paso("editar", "src/cuenta.ts", 9, 2, {
      clase: "editar", ruta: "src/cuenta.ts", masCambios: 0, mas: 2, menos: 1,
      cambios: [{ viejo: corto("  return 1;"), nuevo: corto("  const n = contar();\n  return n + 1;"), todo: false, desde: 2 }],
    }),
    paso("escribir", "src/contar.ts", 12, 1, {
      clase: "escribir", ruta: "src/contar.ts", contenido: corto("export const contar = () => 41;\n"), lineas: 1, nuevo: true, mas: 1, menos: 0,
    }),
    paso("correr", "npm test", 14, 20, {
      clase: "correr", comando: corto("npm test"), descripcion: "Corre los tests", codigo: 1, interrumpido: false, fondo: false,
      salida: { t: `${largo.slice(0, 600)}\n… ${largo.length - 900} caracteres omitidos …\n${largo.slice(-300)}`, total: largo.length, recortado: true },
    }, { estado: "fallo", error: "2 tests fallan" }),
    paso("delegar", "Buscar los usos de usarCuenta", 40, 6, {
      clase: "delegar", descripcion: "Buscar los usos de usarCuenta", agente: "Explore", modelo: "claude-haiku-5-5", prompt: corto(grandes ? PROMPT_LARGO : "Buscá dónde se usa usarCuenta y decime los archivos."),
      respuesta: corto("Se usa en src/pantalla.ts y en su test."), agentId: "a1b2c3d4", fondo: false, tokens: 12_400, usos: 2, pasos: sub, omitidos: 0,
    }),
    paso("correr", "npm test", 50, 18, { clase: "correr", comando: corto("npm test"), descripcion: "Corre los tests", codigo: 0, interrumpido: false, fondo: false, salida: corto("22 pass\n0 fail") }),
    paso("texto", "RESULTADO: arreglé usarCuenta y los tests pasan.", 70, 1, {
      clase: "texto", final: true, texto: corto(grandes ? RESULTADO_LARGO : "RESULTADO: arreglé usarCuenta y los tests pasan. Supuestos: el conteo empieza en 1; no toqué los tests viejos.\nARCHIVOS: src/cuenta.ts, src/contar.ts"),
    }),
  ];
  if (vivo) {
    // Hasta el delegar, y `npm test` todavía corriendo: sin salida, sin código y sin fin.
    const hasta = pasos.slice(0, 7);
    hasta.push(paso("correr", "npm test", 50, null, { clase: "correr", comando: corto("npm test"), descripcion: "Corre los tests", codigo: null, interrumpido: false, fondo: false, salida: corto("# Subtest: usarCuenta\nok 1 - cuenta\n# Subtest: contar") }, { estado: "corriendo" }));
    // Toda la corrida corrida al ahora: el paso en curso lleva 38 s (con el reloj quieto de las capturas, siempre los mismos).
    const delta = Date.now() - 38_000 - (T0 + 50_000);
    for (let i = 0; i < hasta.length; i++) {
      const t = hasta[i].t;
      hasta[i] = { ...hasta[i], t: t === null ? null : t + delta };
    }
    return {
      id, hay: true, gen: 1, v: 9, omitidos: 0, pasos: hasta,
      encabezado: {
        tarea: "Arreglá usarCuenta para que cuente bien", cwd: "/home/usuario/proy/cuentas", modelo: "claude-sonnet-5-5", effort: "medium", turnos: 7,
        tokens: { entrada: 90, cacheCreado: 6_100, cacheLeido: 61_000, salida: 1_500 }, total: 68_690, cache: 61_000 / 67_100,
        inicio: T0 + delta, fin: null, dur: null, compactaciones: 0, pasos: hasta.length,
        archivos: [{ ruta: "src/cuenta.ts", mas: 2, menos: 1, ediciones: 1, nuevo: false }, { ruta: "src/contar.ts", mas: 1, menos: 0, ediciones: 1, nuevo: true }],
        mas: 3, menos: 1,
      },
    };
  }
  return {
    id, hay: true, gen: 1, v: n + 1, omitidos: 0, pasos,
    encabezado: {
      tarea: "Arreglá usarCuenta para que cuente bien", cwd: "/home/usuario/proy/cuentas", modelo: "claude-sonnet-5-5", effort: "medium", turnos: 9,
      tokens: { entrada: 120, cacheCreado: 8_400, cacheLeido: 96_000, salida: 2_300 }, total: 106_820, cache: 96_000 / 104_520,
      inicio: T0, fin: T0 + 71_000, dur: 71_000, compactaciones: 0, pasos: pasos.length,
      archivos: [{ ruta: "src/cuenta.ts", mas: 2, menos: 1, ediciones: 1, nuevo: false }, { ruta: "src/contar.ts", mas: 1, menos: 0, ediciones: 1, nuevo: true }],
      mas: 3, menos: 1,
    },
  };
}

/**
 * Un subagente inventado (la captura `subagente-vista`): `vivo`, el que revisa los tests con `npm test -- cauce`
 * corriendo; si no, el que listó los canales sin prueba, con su informe.
 */
export function pasosSubFijos(id: string, vivo: boolean): VistaPasos {
  n = 0;
  const ahora = Date.now();
  const desde = ahora - (vivo ? 128_000 : 400_000);
  const en = (s: number) => desde + s * 1000;
  const pasos: Paso[] = vivo
    ? [
        paso("buscar", "cauce", 0, 1, { clase: "buscar", herramienta: "Glob", patron: "tests/**/cauce*.test.ts", ruta: null, resultados: 2, texto: corto("tests/cauce.test.ts\ntests/cauce-indice.test.ts") }),
        paso("leer", "tests/cauce.test.ts", 0, 1, { clase: "leer", ruta: "tests/cauce.test.ts", desde: 1, lineas: 4, total: 4, imagen: false, texto: corto('import { test } from "node:test";\nimport { cauce } from "../src/cauce.ts";\n\ntest("arma el índice", () => {});') }),
        paso("pensar", "", 0, 4, { clase: "pensar" }),
        paso("correr", "npm test -- cauce", 0, null, { clase: "correr", comando: corto("npm test -- cauce"), descripcion: "Corre los tests de cauce", codigo: null, interrumpido: false, fondo: false, salida: corto("# Subtest: arma el índice\nok 1 - arma el índice\n# Subtest: indice vacío") }, { estado: "corriendo" }),
      ]
    : [
        paso("buscar", "ipcMain.handle", 0, 1, { clase: "buscar", herramienta: "Grep", patron: "manejar\\(\"", ruta: "electron", resultados: 41, texto: corto('electron/nucleo.ts:932:  manejar("pasos:mirar"\nelectron/nucleo.ts:933:  manejar("pasos:soltar"') }),
        paso("buscar", "pasos:mirar", 0, 1, { clase: "buscar", herramienta: "Grep", patron: "pasos:mirar", ruta: "tests", resultados: 0, texto: corto("No files found") }),
        paso("texto", "Quedan 4 canales sin prueba.", 0, 1, {
          clase: "texto", final: true, texto: corto("Quedan 4 canales sin prueba.\n\n- pasos:mirar\n- pasos:soltar\n- subagentes:leer\n- subagentes:informe"),
        }),
      ];
  // Los tiempos, contados desde que arrancó: 8 s entre paso y paso.
  for (let i = 0; i < pasos.length; i++) pasos[i] = { ...pasos[i], t: en(i * 8) };
  const tokens = vivo ? { entrada: 40, cacheCreado: 4_200, cacheLeido: 55_900, salida: 1_060 } : { entrada: 20, cacheCreado: 1_800, cacheLeido: 7_100, salida: 380 };
  const total = tokens.entrada + tokens.cacheCreado + tokens.cacheLeido + tokens.salida;
  return {
    id, hay: true, gen: 1, v: n + 1, omitidos: 0, pasos,
    encabezado: {
      tarea: null, cwd: null, modelo: vivo ? "claude-sonnet-5-5" : "claude-haiku-5-5", effort: null, turnos: pasos.length,
      tokens, total, cache: tokens.cacheLeido / (total - tokens.salida),
      inicio: desde, fin: vivo ? null : en(90), dur: vivo ? null : 90_000, compactaciones: 0, pasos: pasos.length,
      archivos: [], mas: 0, menos: 0,
    },
  };
}

/**
 * `worker-vista-rutas`: un worker de Windows con rutas largas (chips, pasos, la salida) y líneas de unos 200 caracteres, con el panel de
 * contexto abierto al lado: que la columna central no se corte. Todo inventado (la ruta es de un usuario de mentira).
 */
export function pasosRutasFijos(id: string): VistaPasos {
  n = 0;
  const ruta = "C:\\Users\\usuario\\AppData\\Local\\Temp\\c4\\t10.py";
  const otra = "C:\\Users\\usuario\\AppData\\Local\\Temp\\c4\\utilidades-de-la-carpeta-de-pruebas-con-nombre-largo.ts";
  const linea = "resultado_de_la_prueba = calcular_todo(" + "argumento_de_prueba, ".repeat(9) + "ultimo_valor)";
  const pasos: Paso[] = [
    paso("leer", ruta, 4, 1, { clase: "leer", ruta, desde: 1, lineas: 3, total: 3, imagen: false, texto: corto(`${linea}\nprint(resultado_de_la_prueba)`) }),
    paso("editar", ruta, 9, 2, {
      clase: "editar", ruta, masCambios: 0, mas: 31, menos: 0,
      cambios: [{ viejo: corto("  pass"), nuevo: corto(linea), todo: false, desde: 2 }],
    }),
    paso("editar", otra, 11, 2, {
      clase: "editar", ruta: otra, masCambios: 0, mas: 4, menos: 2,
      cambios: [{ viejo: corto("export const x = 1;"), nuevo: corto(`export const x = "${linea}";`), todo: false, desde: 1 }],
    }),
    paso("correr", `python ${ruta}`, 14, 3, {
      clase: "correr", comando: corto(`python ${ruta} --verbose --salida ${otra}`), descripcion: "Corre el script de prueba", codigo: 0, interrumpido: false, fondo: false,
      salida: corto(`${linea}\nlistos: ${"ruta_de_salida_muy_larga/".repeat(8)}t10.py`),
    }),
    paso("texto", "RESULTADO: arreglé el script.", 20, 1, {
      clase: "texto", final: true,
      texto: corto(`RESULTADO: arreglé el script en ${ruta} y guardé la salida en ${"carpeta_con_nombre_larguisimo_sin_espacios/".repeat(4)}fin.\nARCHIVOS: ${ruta}, ${otra}`),
    }),
  ];
  return {
    id, hay: true, gen: 1, v: n + 1, omitidos: 0, pasos,
    encabezado: {
      tarea: "Arreglá el script de Windows", cwd: "C:\\Users\\usuario\\proy", modelo: "claude-sonnet-5-5", effort: "medium", turnos: 5,
      tokens: { entrada: 120, cacheCreado: 8_400, cacheLeido: 96_000, salida: 2_300 }, total: 106_820, cache: 96_000 / 104_520,
      inicio: T0, fin: T0 + 25_000, dur: 25_000, compactaciones: 0, pasos: pasos.length,
      archivos: [{ ruta, mas: 31, menos: 0, ediciones: 1, nuevo: true }, { ruta: otra, mas: 4, menos: 2, ediciones: 1, nuevo: false }],
      mas: 35, menos: 2,
    },
  };
}

// ---- La captura `worker-vista-hilo`: una corrida entera, contada en segundos reales (todo inventado) --------------------------------

const GREP_RUTAS = [
  'src/db/rutas-repo.ts:48:const filas = await db.query("SELECT * FROM rutas WHERE zona_id = $1 ORDER BY creada_en DESC LIMIT $2", [zona, limite]);',
  'src/db/rutas-repo.ts:71:return db.query("SELECT count(*) FROM rutas WHERE zona_id = $1 AND estado = $2", [zona, "activa"]);',
  "src/db/rutas-repo.ts:103:await db.query(\"DELETE FROM rutas WHERE vence_en < now() - interval '90 days' RETURNING id\");",
  "src/api/rutas/listar.ts:22:// antes: SELECT * FROM rutas sin filtro; se dejó de usar cuando entraron las zonas",
  'src/informes/por-zona.ts:37:const sql = "SELECT zona_id, count(*) AS total, avg(distancia_km) AS media FROM rutas GROUP BY zona_id ORDER BY total DESC";',
  'src/informes/por-zona.ts:64:const vacias = await db.query("SELECT z.id FROM zonas z LEFT JOIN (SELECT zona_id FROM rutas) r ON r.zona_id = z.id WHERE r.zona_id IS NULL");',
  'src/tareas/purgar.ts:15:await db.query("SELECT id FROM rutas WHERE vence_en < now() FOR UPDATE SKIP LOCKED");',
].join("\n");

const MIGRACION = `-- Las consultas por zona ordenan por fecha: sin esto, un seq scan sobre 2,1 M de filas.
CREATE INDEX CONCURRENTLY rutas_zona_fecha_idx
  ON rutas (zona_id, creada_en DESC);

-- El conteo de rutas activas filtra por zona y estado; las purgadas no cuentan.
CREATE INDEX CONCURRENTLY rutas_zona_activas_idx
  ON rutas (zona_id)
  WHERE estado = 'activa';

-- El de fecha sola no lo usa ninguna consulta.
DROP INDEX CONCURRENTLY IF EXISTS rutas_creada_en_idx;

ANALYZE rutas;
`;

const TESTS_OK = `> atlas@2.8.1 test
> node scripts/test.mjs

▶ rutas-repo
  ✔ listarRutas filtra por zona (38 ms)
  ✔ listarRutas ordena por fecha dentro de la zona (41 ms)
  ✔ el plan de la consulta usa rutas_zona_fecha_idx y no hace seq scan sobre la tabla entera (112 ms)
▶ rutas-migracion
  ✔ aplica 0042 sobre una base vacía (640 ms)
  ✔ revierte 0042 sin perder filas (702 ms)
▶ rutas-integracion
  ✔ lista rutas contra la base de prueba (1,2 s)
  ✔ reintenta cuando la base corta la conexión (3,1 s)

ℹ tests 214
ℹ pass 214
ℹ fail 0`;

const TESTS_MAL = `▶ rutas-integracion
  ✔ lista rutas contra la base de prueba (1,2 s)
  ✖ reintenta cuando la base corta la conexión (3,1 s)
    tests/rutas-integracion.test.ts:88:14
    AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal: 49 !== 50, faltó la última fila de la página porque el cursor ya estaba cerrado cuando volvió la conexión
      at listarRutas (src/db/rutas-repo.ts:52:11)
      at reintentar (src/db/conexion.ts:31:9)
  ✖ el informe por zona no cambia con el índice nuevo (88 ms)
    tests/informes/por-zona.test.ts:41:5
    AssertionError [ERR_ASSERTION]: el orden de las zonas con el mismo total cambió: esperaba [12, 7, 31] y recibió [7, 12, 31]

ℹ tests 214
ℹ pass 212
ℹ fail 2
exit 1`;

const CONSIGNA_ATLAS = "Auditá los índices de la tabla rutas en la base de atlas. Buscá las consultas que hacen seq scan, proponé los índices que faltan en una migración nueva y corré todos los tests. No toques el esquema de envíos. Si un índice nuevo pide reescribir una consulta, reescribila vos y dejalo dicho en el resultado.";
const CWD_ATLAS = "/home/usuario/proy/atlas";

export type VarianteHilo = "trabajando" | "trabado" | "termino" | "fallo";

/** Una corrida con cada cosa que la vista sabe contar: pensamientos cortos y largos, búsquedas y lecturas seguidas, ediciones, un commit y, según `variante`, cómo termina. */
export function pasosHiloFijos(id: string, variante: VarianteHilo): VistaPasos {
  n = 0;
  const pasos: Paso[] = [];
  let reloj = 0;
  /** Una herramienta: arranca ahora y tarda `seg`. */
  const hacer = (tipo: TipoPaso, titulo: string, seg: number | null, detalle: Detalle, mas: Partial<Paso> = {}) => {
    pasos.push(paso(tipo, titulo, reloj, seg, detalle, mas));
    reloj += seg ?? 0;
  };
  /** Un pensamiento: su hora es la de cuando terminó. */
  const pensar = (seg: number, texto?: string) => {
    reloj += seg;
    pasos.push(paso("pensar", "", reloj, seg, texto ? { clase: "pensar", texto: corto(texto) } : { clase: "pensar" }));
  };
  const leer = (ruta: string, seg: number, texto = "// …") => hacer("leer", ruta, seg, { clase: "leer", ruta: `${CWD_ATLAS}/${ruta}`, desde: 1, lineas: texto.split("\n").length, total: 120, imagen: false, texto: corto(texto) });
  const grep = (patron: string, seg: number, texto: string, resultados: number) => hacer("buscar", patron, seg, { clase: "buscar", herramienta: "Grep", patron, ruta: "src", resultados, texto: corto(texto) });
  const bash = (comando: string, descripcion: string | null, seg: number | null, salida: string, codigo: number | null = 0, mas: Partial<Paso> = {}) =>
    hacer("correr", comando, seg, { clase: "correr", comando: corto(comando), descripcion, salida: salida ? corto(salida) : null, codigo, interrumpido: false, fondo: false }, mas);

  leer("AGENTS.md", 5, "# atlas\n\n- Las migraciones van numeradas y se prueban en la base de prueba.\n- Nada de SELECT * en código nuevo.");
  pensar(9);
  grep("FROM rutas", 7, GREP_RUTAS, 7);
  grep("zona_id", 4, "src/db/rutas-repo.ts:48:WHERE zona_id = $1", 1);
  grep("listarRutas\\(", 6, "src/api/rutas/listar.ts:30:await listarRutas(zona)", 1);
  grep("CREATE INDEX", 5, "migraciones/0038_rutas.sql:12:CREATE INDEX rutas_creada_en_idx ON rutas (creada_en);", 1);
  grep("ORDER BY creada_en", 5, "src/db/rutas-repo.ts:48:ORDER BY creada_en DESC", 1);
  grep("rutas", 4, "tests/rutas.test.ts\ntests/rutas-integracion.test.ts", 2);
  leer("src/db/rutas-repo.ts", 5);
  leer("migraciones/0038_rutas.sql", 3);
  leer("src/db/zonas.ts", 3);
  leer("tests/rutas.test.ts", 3);
  pensar(48);
  bash(`psql "$DB_PRUEBA" -c 'EXPLAIN ANALYZE SELECT * FROM rutas WHERE zona_id = 12 ORDER BY creada_en DESC LIMIT 50'`, "Mide el plan de la consulta por zona", 23, "Seq Scan on rutas  (cost=0.00..48211.40 rows=1842 width=212) (actual time=0.041..812.330 rows=1790 loops=1)\n  Filter: (zona_id = 12)\n  Rows Removed by Filter: 2098210\nExecution Time: 814.902 ms");
  pensar(6, "conviene un índice en (zona_id, creada_en); el de fecha sola no lo usa nadie.");
  hacer("escribir", "migraciones/0042_indices_rutas.sql", 4, { clase: "escribir", ruta: `${CWD_ATLAS}/migraciones/0042_indices_rutas.sql`, contenido: corto(MIGRACION), lineas: 13, nuevo: true, mas: 13, menos: 0 });
  hacer("editar", "src/db/rutas-repo.ts", 6, {
    clase: "editar", ruta: `${CWD_ATLAS}/src/db/rutas-repo.ts`, masCambios: 0, mas: 2, menos: 1,
    cambios: [{ viejo: corto('const filas = await db.query("SELECT * FROM rutas WHERE zona_id = $1", [zona]);'), nuevo: corto('const filas = await db.query(\n  "SELECT id, zona_id, creada_en FROM rutas WHERE zona_id = $1 ORDER BY creada_en DESC LIMIT $2", [zona, limite]);'), todo: false, desde: 48 }],
  });
  pensar(7);
  bash("npm run migrar -- --base prueba", "Aplica la migración en la base de prueba", 19, "0042_indices_rutas ... ok (17,4 s)");
  bash("npm test -- rutas", "Corre los tests de rutas", 18, "▶ rutas-repo\n  ✔ listarRutas filtra por zona (38 ms)\n\nℹ tests 22\nℹ pass 22\nℹ fail 0");
  bash('git add migraciones src/db && git commit -m "rutas: índice compuesto por zona y fecha"', null, 3, "[pa/atlas/rutas a41f9c2] rutas: índice compuesto por zona y fecha\n 2 files changed, 15 insertions(+), 1 deletion(-)");
  pensar(5);

  const archivos = [
    { ruta: `${CWD_ATLAS}/migraciones/0042_indices_rutas.sql`, mas: 13, menos: 0, ediciones: 1, nuevo: true },
    { ruta: `${CWD_ATLAS}/src/db/rutas-repo.ts`, mas: 2, menos: 1, ediciones: 1, nuevo: false },
  ];
  let fin: number | null = null;
  let dur: number | null = null;
  // Los que siguen corriendo se corren al ahora: el paso en curso lleva lo que dice la captura (con el reloj quieto, siempre lo mismo).
  let correrA: number | null = null;

  if (variante === "trabajando") {
    correrA = 38;
    bash("npm test", "Corre todos los tests", null, "", null, { estado: "corriendo" });
  } else if (variante === "trabado") {
    // La última novedad del transcript fue a los 48 s del comando; hace rato que no llega nada.
    correrA = 760;
    bash("npm test", "Corre todos los tests", null, "", null, { estado: "corriendo" });
  } else if (variante === "termino") {
    bash("npm test", "Corre todos los tests", 41, TESTS_OK);
    pensar(4);
    hacer("texto", "RESULTADO", 3, { clase: "texto", final: true, texto: corto("RESULTADO: Agregó el índice de rutas y los tests pasan.\nARCHIVOS: migraciones/0042_indices_rutas.sql, src/db/rutas-repo.ts") });
    fin = T0 + reloj * 1000;
    dur = reloj * 1000;
  } else {
    bash("npm test", "Corre todos los tests", 61, TESTS_MAL, 1, { estado: "fallo", error: "2 tests fallan" });
    pensar(12);
    hacer("editar", "src/db/rutas-repo.ts", 8, {
      clase: "editar", ruta: `${CWD_ATLAS}/src/db/rutas-repo.ts`, masCambios: 0, mas: 2, menos: 1,
      cambios: [{ viejo: corto("ORDER BY creada_en DESC"), nuevo: corto("ORDER BY creada_en DESC, id DESC\n-- desempata las filas de la misma fecha"), todo: false, desde: 49 }],
    });
    bash("npm test", "Vuelve a correr los tests", 44, TESTS_MAL, 1, { estado: "fallo", error: "2 tests fallan" });
    hacer("texto", "RESULTADO", 1, { clase: "texto", final: true, texto: corto("RESULTADO: Se quedó sin cupo con 2 tests en rojo.") });
    archivos[1] = { ...archivos[1], mas: 4, menos: 2, ediciones: 2 };
    fin = T0 + reloj * 1000;
    dur = reloj * 1000;
  }

  const ajustados = correrA === null ? pasos : pasos.map((p) => ({ ...p, t: p.t === null ? null : p.t + (Date.now() - correrA! * 1000 - (T0 + reloj * 1000)) }));
  const inicio = correrA === null ? T0 : T0 + (Date.now() - correrA * 1000 - (T0 + reloj * 1000));
  return {
    id, hay: true, gen: 1, v: n + 1, omitidos: 0, pasos: ajustados,
    encabezado: {
      tarea: CONSIGNA_ATLAS, cwd: CWD_ATLAS, modelo: "claude-sonnet-5-5", effort: "medium", turnos: 22,
      tokens: { entrada: 300, cacheCreado: 9_100, cacheLeido: 96_000, salida: 2_800 }, total: 108_200, cache: 96_000 / 105_400,
      inicio,
      // Trabado: lo último que se supo fue a los 48 s del comando.
      fin: variante === "trabado" ? inicio + (reloj + 48) * 1000 : fin,
      dur, compactaciones: 0, pasos: ajustados.length, archivos,
      mas: archivos.reduce((a, x) => a + x.mas, 0), menos: archivos.reduce((a, x) => a + x.menos, 0),
    },
  };
}
