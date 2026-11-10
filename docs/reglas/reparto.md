# Reglas: reparto

Salieron de `AGENTS.md` (sección «Cómo se trabaja» y «Mapa rápido»): van enteras, sin resumir.

## Del líder a los workers

- **Líder → workers:** se delega con `--tipo` y SIN `-m` ni `--effort` (los elige `reparto`); `-m` sólo con motivo (skill `trama-orquestar`). Si `reparto` falla,
el resultado del worker lo dice («— reparto NO eligió el modelo», archivo `<id>.reparto-fallo`).

## Perfil de reparto `agresivo`

- **Perfil de reparto `agresivo` (`PERFILES` en `motor/bin/reparto` y su par `app/electron/cli/reparto.ts`; el TS es el que corre por defecto, `TRAMA_REPARTO=py` fuerza el python):** gana el más barato (`costo` relativo: gratis 0, el resto el de su familia) entre lo que supera `minimo_por_tipo`,
que sigue siendo piso duro (no se relaja como en `ahorro`); el puntaje sólo desempata. Reserva del líder 0,35 como `ahorro`. Un modelo que no gasta cupo (local, dsh/OpenCode) sin historial propio sólo entra en `lectura`/`mecanico` hasta tener
5 corridas con dato y ≥ 50 % sin retrabajo en ESE tipo (medicion.tsv de los últimos 60 días, el mismo criterio de `pa --rinde`; `REPARTO_MEDICION` lo redirige en los tests); si no queda nada más, vuelve a entrar y el motivo lo dice. Flash
sólo lee. `rendimiento` y `equilibrado` dan lo mismo con ritmo normal: la banda de calidad (`PESO_SOBRA`, `PREFERIDO_POR_TIPO`) ya decide. `reparto --tipo --json` suma `perfil_info` y, por candidato, `costo` e `historial` (`{n, ok_pct}`) para la interfaz.
Con `ahorro` o `agresivo`, `pa` avisa por stderr al lanzar (`avisoPerfilAhorro` en `cli/pa/cli.ts`, `aviso_perfil_ahorro` en el bash) que el brief lleve pasos, archivos, «Listo cuando» y chequeo. Lo cubre `tests/reparto-agresivo.test.ts`.

## Perfil de reparto en el riel

- **Perfil de reparto en el riel (`app/src/barra/PerfilRiel.tsx`, datos en `src/datos/perfil-reparto.ts`):** el ícono bajo los anillos de cupos (`data-guia="perfil-riel"`, un ícono por perfil, nunca sólo color) abre un menú con los cuatro perfiles; elegir uno
guarda al toque en `modelos.json` por `guardarModelos` (relee lo guardado y cambia SÓLO `perfil`, así no pisa lo que Ajustes tenga a medio editar), sin barra de Guardar; si falla vuelve al anterior y dice el motivo. Vale para los workers nuevos (`reparto` lee el archivo
en cada lanzamiento). Riel y Ajustes se avisan con el evento `trama:perfil-reparto` (`EVENTO_PERFIL`): Ajustes lo escucha en `AjustesModelos.tsx` y avisa al guardar. Los textos de cada perfil son los de `cu.perfil*` (los mismos en Ajustes); el de `agresivo` tiene que decir lo que hace
`aplicar_agresivo` en `motor/bin/reparto`. Captura `perfil-riel` (menú abierto). Lo cubre `tests/perfil-riel.test.ts`. Ojo: en un worktree dentro de `~/.local/state/pa/worktrees/` `npm run visual` falla en todos los casos (`aislar.ts` ve `motor/opencode/go-topes.mjs` como «de la persona»), también en `normal`.
