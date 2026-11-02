// Los datos inventados de la maqueta: una sola corrida contada en segundos reales. Todo lo que se ve (anchos de la tira,
// tiempos, totales, conteos, +/-) sale de acá: nada se escribe dos veces. Los pasos van en palabras; el comando crudo, aparte.
(() => {
  const g = (es, en, seg, cmd, salida, extra) => ({ tipo: "leer", es, en, seg, cmd, salida, ...extra });
  const pensar = (seg, es, en) => ({ tipo: "pensar", seg, texto: es ? { es, en } : null });

  // Lo que devuelve la primera búsqueda: líneas largas a propósito, para ver que se ajustan al ancho.
  const GREP = {
    grep: [
      ["src/db/rutas-repo.ts", 48, 'const filas = await db.query("SELECT * FROM rutas WHERE zona_id = $1 ORDER BY creada_en DESC LIMIT $2", [zona, limite]);'],
      ["src/db/rutas-repo.ts", 71, 'return db.query("SELECT count(*) FROM rutas WHERE zona_id = $1 AND estado = $2", [zona, "activa"]);'],
      ["src/db/rutas-repo.ts", 103, 'await db.query("DELETE FROM rutas WHERE vence_en < now() - interval \'90 days\' RETURNING id");'],
      ["src/api/rutas/listar.ts", 22, '// antes: SELECT * FROM rutas sin filtro; se dejó de usar cuando entraron las zonas'],
      ["src/informes/por-zona.ts", 37, 'const sql = "SELECT zona_id, count(*) AS total, avg(distancia_km) AS media FROM rutas GROUP BY zona_id ORDER BY total DESC";'],
      ["src/informes/por-zona.ts", 64, 'const vacias = await db.query("SELECT z.id FROM zonas z LEFT JOIN (SELECT zona_id FROM rutas) r ON r.zona_id = z.id WHERE r.zona_id IS NULL");'],
      ["src/tareas/purgar.ts", 15, 'await db.query("SELECT id FROM rutas WHERE vence_en < now() FOR UPDATE SKIP LOCKED");'],
    ],
  };

  const DIFF = {
    diff: [
      ["+", 1, "-- Las consultas por zona ordenan por fecha: sin esto, un seq scan sobre 2,1 M de filas."],
      ["+", 2, "CREATE INDEX CONCURRENTLY rutas_zona_fecha_idx"],
      ["+", 3, "  ON rutas (zona_id, creada_en DESC);"],
      ["+", 4, ""],
      ["+", 5, "-- El de fecha sola no lo usa ninguna consulta."],
      ["+", 6, "DROP INDEX CONCURRENTLY IF EXISTS rutas_creada_en_idx;"],
    ],
  };

  const TESTS_OK_INICIO = [
    "> atlas@2.8.1 test",
    "> node scripts/test.mjs",
    "",
    "▶ rutas-repo",
    "  ✔ listarRutas filtra por zona (38 ms)",
    "  ✔ listarRutas ordena por fecha dentro de la zona (41 ms)",
    "  ✔ el plan de la consulta usa rutas_zona_fecha_idx y no hace seq scan sobre la tabla entera (112 ms)",
    "▶ rutas-migracion",
    "  ✔ aplica 0042 sobre una base vacía (640 ms)",
    "  ✔ revierte 0042 sin perder filas (702 ms)",
    "▶ zonas",
    "  ✔ una zona sin rutas devuelve una lista vacía (12 ms)",
    "  ✔ borrar una zona deja sus rutas en la zona por defecto (54 ms)",
    "▶ informes/por-zona",
    "  ✔ cuenta sólo las rutas activas (29 ms)",
    "  ✔ la media de distancia ignora las rutas sin kilómetros cargados (33 ms)",
  ];

  // Los pasos comunes a todas las corridas (198 s).
  const COMUNES = [
    { tipo: "leer", es: "Leyó las reglas del proyecto", en: "Read the project rules", seg: 5, cmd: "Read AGENTS.md", salida: { texto: ["# atlas", "", "- Las migraciones van numeradas y se prueban en la base de prueba.", "- Nada de SELECT * en código nuevo."] } },
    pensar(9),
    { grupo: "buscar", es: "Buscó en el código", en: "Searched the code", hijos: [
      g("Buscó dónde se consulta la tabla rutas", "Searched where the routes table is queried", 7, 'grep -rn "FROM rutas" src/ --include="*.ts"', GREP),
      g("Buscó los filtros por zona", "Searched the filters by zone", 4, 'grep -rn "zona_id" src/db/', { texto: [] }),
      g("Buscó quién llama a listarRutas", "Searched who calls listarRutas", 6, 'grep -rn "listarRutas(" src/', { texto: [] }),
      g("Buscó los índices que ya existen", "Searched the existing indexes", 5, 'grep -n "CREATE INDEX" migraciones/*.sql', { texto: [] }),
      g("Buscó consultas que ordenan por fecha", "Searched queries that sort by date", 5, 'grep -rn "ORDER BY creada_en" src/db/', { texto: [] }),
      g("Buscó los tests de la tabla rutas", "Searched the tests of the routes table", 4, 'grep -rln "rutas" tests/', { texto: [] }),
    ] },
    { grupo: "leer", es: "Leyó 4 archivos", en: "Read 4 files", hijos: [
      g("Leyó rutas-repo.ts", "Read rutas-repo.ts", 5, "Read src/db/rutas-repo.ts", { texto: [] }),
      g("Leyó la migración de rutas", "Read the routes migration", 3, "Read migraciones/0038_rutas.sql", { texto: [] }),
      g("Leyó zonas.ts", "Read zonas.ts", 3, "Read src/db/zonas.ts", { texto: [] }),
      g("Leyó los tests de rutas", "Read the routes tests", 3, "Read tests/rutas.test.ts", { texto: [] }),
    ] },
    pensar(48),
    { tipo: "correr", es: "Midió el plan de la consulta por zona", en: "Measured the plan of the zone query", seg: 23, cmd: `psql "$DB_PRUEBA" -c 'EXPLAIN ANALYZE SELECT * FROM rutas WHERE zona_id = 12 ORDER BY creada_en DESC LIMIT 50'`, salida: { texto: ["Seq Scan on rutas  (cost=0.00..48211.40 rows=1842 width=212) (actual time=0.041..812.330 rows=1790 loops=1)", "  Filter: (zona_id = 12)", "  Rows Removed by Filter: 2098210", "Execution Time: 814.902 ms"] } },
    pensar(6, "conviene un índice en (zona_id, creada_en); el de fecha sola no lo usa nadie.", "an index on (zona_id, creada_en) fits best; nobody uses the date-only one."),
    { tipo: "editar", verbo: "escribir", es: "Escribió la migración de índices", en: "Wrote the index migration", seg: 4, archivo: "migraciones/0042_indices_rutas.sql", mas: 18, menos: 0, cmd: "Write migraciones/0042_indices_rutas.sql", salida: DIFF },
    { tipo: "editar", es: "Cambió listarRutas para que use el índice", en: "Changed listarRutas to use the index", seg: 6, archivo: "src/db/rutas-repo.ts", mas: 4, menos: 2, cmd: "Edit src/db/rutas-repo.ts", salida: DIFF },
    pensar(7),
    { tipo: "correr", es: "Aplicó la migración en la base de prueba", en: "Applied the migration to the test database", seg: 19, cmd: "npm run migrar -- --base prueba", salida: { texto: ["0042_indices_rutas ... ok (17,4 s)"] } },
    { tipo: "correr", es: "Corrió los tests de rutas", en: "Ran the routes tests", seg: 18, cmd: "npm test -- rutas", tests: 22, salida: { texto: ["22 pasan"] } },
    { tipo: "correr", verbo: "commit", es: "Guardó el commit del índice", en: "Committed the index", seg: 3, hash: "a41f9c2", cmd: 'git commit -m "rutas: índice compuesto por zona y fecha"', salida: { texto: ["[pa/atlas/rutas a41f9c2] rutas: índice compuesto por zona y fecha", " 2 files changed, 22 insertions(+), 2 deletions(-)"] } },
    pensar(5),
  ];

  const TODOS = { es: "todos los tests", en: "the full test suite" };

  const CORRIDAS = {
    trabajando: () => [
      ...COMUNES,
      { tipo: "correr", vivo: true, es: "Corriendo todos los tests", en: "Running the full test suite", seg: 38, cmd: "npm test", salida: { texto: TESTS_OK_INICIO, sigue: true } },
    ],
    trabado: () => [
      ...COMUNES,
      { tipo: "correr", vivo: true, trabado: true, ultimaSalida: 48, es: "Corriendo todos los tests", en: "Running the full test suite", seg: 760, cmd: "npm test", salida: { texto: [...TESTS_OK_INICIO, "▶ rutas-integracion", "  ✔ lista rutas contra la base de prueba (1,2 s)", "  ⏵ reintenta cuando la base corta la conexión a mitad de una transacción larga"], colgado: true } },
    ],
    termino: () => [
      ...COMUNES,
      { tipo: "correr", es: "Corrió todos los tests", en: "Ran the full test suite", seg: 41, cmd: "npm test", tests: 214, salida: { texto: [...TESTS_OK_INICIO, "▶ rutas-integracion", "  ✔ lista rutas contra la base de prueba (1,2 s)", "  ✔ reintenta cuando la base corta la conexión (3,1 s)", "", "ℹ tests 214", "ℹ pass 214", "ℹ fail 0"] } },
      pensar(4),
      { tipo: "texto", es: "Escribió el resultado", en: "Wrote the result", seg: 3, cmd: "", salida: { texto: [] } },
    ],
    fallo: () => [
      ...COMUNES,
      { tipo: "correr", error: 1, es: "Corrió todos los tests: 2 fallan", en: "Ran the full test suite: 2 fail", seg: 61, cmd: "npm test", salida: { texto: [] } },
      pensar(12),
      { tipo: "editar", es: "Corrigió el orden por fecha", en: "Fixed the date order", seg: 8, archivo: "src/db/rutas-repo.ts", mas: 2, menos: 1, cmd: "Edit src/db/rutas-repo.ts", salida: DIFF },
      { tipo: "correr", error: 1, es: "Volvió a correr los tests: 2 fallan", en: "Ran the tests again: 2 still fail", seg: 44, cmd: "npm test", salida: { falla: true, texto: [
        "▶ rutas-integracion",
        "  ✔ lista rutas contra la base de prueba (1,2 s)",
        "  ✖ reintenta cuando la base corta la conexión (3,1 s)",
        "    tests/rutas-integracion.test.ts:88:14",
        "    AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal: 49 !== 50, faltó la última fila de la página porque el cursor ya estaba cerrado cuando volvió la conexión",
        "      at listarRutas (src/db/rutas-repo.ts:52:11)",
        "      at reintentar (src/db/conexion.ts:31:9)",
        "  ✖ el informe por zona no cambia con el índice nuevo (88 ms)",
        "    tests/informes/por-zona.test.ts:41:5",
        "    AssertionError [ERR_ASSERTION]: el orden de las zonas con el mismo total cambió: esperaba [12, 7, 31] y recibió [7, 12, 31]",
        "",
        "ℹ tests 214",
        "ℹ pass 212",
        "ℹ fail 2",
        "exit 1",
      ] } },
    ],
  };

  window.CORRIDAS = CORRIDAS;
  window.TODOS = TODOS;

  window.CONSIGNA = {
    es: "Auditá los índices de la tabla rutas en la base de atlas. Buscá las consultas que hacen seq scan, proponé los índices que faltan en una migración nueva y corré todos los tests. No toques el esquema de envíos. Si un índice nuevo pide reescribir una consulta, reescribila vos y dejalo dicho en el resultado.",
    en: "Audit the indexes on the routes table in the atlas database. Find the queries doing a seq scan, propose the missing indexes in a new migration and run the full test suite. Don't touch the shipments schema. If a new index needs a query rewritten, rewrite it and say so in the result.",
  };

  window.TITULO = { es: "Auditar los índices de la tabla de rutas", en: "Audit the indexes on the routes table" };
})();
