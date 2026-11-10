# Reglas: tests

Salieron de `AGENTS.md` (sección «Cómo se trabaja» y «Mapa rápido»): van enteras, sin resumir.

## Tests

- **Tests:** los tests no esperan por reloj; usá `esperarHasta` de `app/tests/esperar.ts` o `mock.timers`; una espera legítima lleva `// espera-justificada: <motivo>`.
Bajo carga: un `probarLocal`/`asegurarLocal` sin `await` deja el lock `probando` tomado y la carpeta de la prueba sin borrar (ENOTEMPTY); cada probe se espera o se suelta en el `finally`. Un `setTimeout` de 20-30 ms para «que arranque lo otro» no alcanza: se espera la condición. Las escrituras disparadas con `void` las espera `esperarEscrituras` (`electron/pa.ts`) al cerrar. Altas en vuelo de `nuevo` (`registrarCarpetas`): `esperarRegistros` antes de tocar el registry en un test.

## Tests y plataforma

- **Tests y plataforma (el CI corre en Windows):** una ruta real (`os.tmpdir()`, `path.join`) en Windows es `C:\…`: nunca la mezcles con `plat: "linux"` (`path.posix` la toma como un solo segmento) ni le apliques `.replace(/^\//, "")` ni le sumes `"/"`. Para probar la lógica de OTRA plataforma: rutas literales de esa plataforma y disco falso (`existe`/`leer`/`real`, como `tests/motor-resolver.test.ts`); con disco real, sin inyectar la plataforma y con `path.join`/`path.sep`. Tampoco lances escrituras simultáneas al mismo archivo con `writeFile` crudo: se mezclan y el test falla a veces.
