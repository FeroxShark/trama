# Reglas: tests

Salieron de `AGENTS.md` (sección «Cómo se trabaja» y «Mapa rápido»): van enteras, sin resumir.

## Tests

- **Tests:** los tests no esperan por reloj; usá `esperarHasta` de `app/tests/esperar.ts` o `mock.timers`; una espera legítima lleva `// espera-justificada: <motivo>`.
Bajo carga: un `probarLocal`/`asegurarLocal` sin `await` deja el lock `probando` tomado y la carpeta de la prueba sin borrar (ENOTEMPTY); cada probe se espera o se suelta en el `finally`. Un `setTimeout` de 20-30 ms para «que arranque lo otro» no alcanza: se espera la condición. Las escrituras disparadas con `void` las espera `esperarEscrituras` (`electron/pa.ts`) al cerrar. Altas en vuelo de `nuevo` (`registrarCarpetas`): `esperarRegistros` antes de tocar el registry en un test.

## Tests y plataforma

- **Tests y plataforma (el CI corre en Windows):** una ruta real (`os.tmpdir()`, `path.join`) en Windows es `C:\…`: nunca la mezcles con `plat: "linux"` (`path.posix` la toma como un solo segmento) ni le apliques `.replace(/^\//, "")` ni le sumes `"/"`. Para probar la lógica de OTRA plataforma: rutas literales de esa plataforma y disco falso (`existe`/`leer`/`real`, como `tests/motor-resolver.test.ts`); con disco real, sin inyectar la plataforma y con `path.join`/`path.sep`. Tampoco lances escrituras simultáneas al mismo archivo con `writeFile` crudo: se mezclan y el test falla a veces.

## Correr tests sin gastar el tool

- **Un test:** `node scripts/test.mjs tests/x.test.ts` (o `x.test.ts` a secas) corre sólo ese archivo; equivale a `TRAMA_TEST_SOLO=x.test.ts`. Un argumento que parece archivo (termina en `.ts` o lleva barra) y no existe en `tests/` corta con código 2 y su nombre: nunca corre los 400 por un nombre mal escrito. Los de `tests/paridad` se piden con `--paridad`.
- **`npm run check:changed`:** tsc de interfaz y electron, los tests afectados y la paridad **sólo de las herramientas tocadas**: la tabla `PARIDAD` de `scripts/check-changed.mjs` más las herramientas cuyo archivo de entrada (`cli/pa.ts`, `cli/tablero.ts`…) importa, directo o por cadena, lo que cambió (un `cli/pa/rinde.ts` corre `pa`, `pa-async` y `pa-cli`; ~450 de 1200 casos). La paridad completa (~9 min sola, no entra en el tool de 10 min) sólo con `--paridad-completa` o si cambia `tests/paridad/`. Tocar `scripts/test.mjs`, `package.json` o los tsconfig corre todos los tests de `tests/`, no toda la paridad. Lo del motor que no está en la tabla ni lo importa una herramienta no corre paridad y se avisa («sin paridad»).
- **Al empezar** imprime cuántos archivos de prueba y casos de paridad va a correr y una estimación (con el factor de carga de la máquina); si pasa de ~8 min avisa, y ahí se parte en pasos: un test con `test.mjs <ruta>`, y la paridad aparte (`TRAMA_PARIDAD_HERRAMIENTA=<h> node scripts/test.mjs --paridad paridad.test.ts`).
- **En partes:** la paridad corre en varios procesos a la vez (`TRAMA_PARIDAD_PARTE=i/n` en `paridad.test.ts`; `TRAMA_CHECK_PARTES` cambia cuántos, por defecto núcleos/3 hasta 4), cada uno con su casa. Medido con poca carga: pa+pa-async+pa-cli (450 casos) ~2 min en vez de 5,5; la paridad entera (1217 casos) ~3,7 min en vez de 9. Dos casos de `pa-cli: ayuda` fallan hoy en main (texto de ayuda del TS vs el bash congelado), no es del chequeo.
- **Tope propio:** la paridad corre con `TRAMA_TEST_ARCHIVO_S` (540 s por herramientas, 900 s completa; `TRAMA_CHECK_TOPE_S` lo cambia). Si un archivo lo pasa, `test.mjs` lo mata con su grupo y sale 124; `check:changed` imprime «tope en …, colgó: <archivo>» y sale 124. `TRAMA_CHECK_BASE=<commit>` compara contra otro commit (para medir).
- **Con la máquina cargada** (otros workers, `uptime` con load > núcleos) todo tarda el doble: no mates ni relances; mirá la estimación antes de lanzar y usá `timeout` del tool (600000), nunca el `timeout` del shell.
