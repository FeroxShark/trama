# Modo debate entre modelos (etapa 2): diseño e implementación

Pedido de Ferox (2026-11-15). La etapa 1 («Revisar con otro modelo», `app/electron/revision-plan.ts`) ya está: este doc deja el diseño para que otra corrida implemente el debate.

## Qué es

Ferox activa el modo debate sobre el plan de un líder, elige 2 o 3 modelos, ellos debaten en rondas, cortan antes si coinciden del todo, y llegan a una conclusión conjunta. El líder original rehace el plan con ella. Ferox ve el debate en vivo y los modelos le pueden preguntar algo con botones.

## Piezas

1. **Entrada.** Al lado de «Revisar con otro modelo» en el plan del líder (`PedidoPermiso` en `app/src/hilo/Lider.tsx`), un interruptor «Debate»: el selector (`SeguirCon` con `de="revisar"`) pasa a elegir 2 o 3 modelos (casillas). Mismos modelos que el revisor (`revisoresPermitidos`: Claude o Gemini, no desactivados en Ajustes, con cupo por `reparto`).
2. **Moderador** (`app/electron/debate.ts`, nuevo, sin Electron, con `DepsDebate` inyectadas como `revisarPlan`): lleva el estado `{id, sid, plan, participantes, ronda, turnos[], estado}` y corre los turnos de a uno (nunca en paralelo: cada uno lee lo dicho por los otros).
3. **Corredor** de un turno: `correrRevisor` (ya existe; un turno = una llamada de una sola vez por suscripción, sin `ANTHROPIC_API_KEY`).
4. **Vista en vivo** (`app/src/hilo/TarjetaDebate.tsx`): una tarjeta que crece turno a turno, un renglón por turno con el nombre del modelo, la ronda y su postura («de acuerdo», «propone cambio», «pregunta»). Se alimenta por un evento nuevo `debate:turno` (canal de aviso, también en la carcasa de Windows: `app/electron/canales/contrato.ts`).
5. **Pregunta a Ferox** con botones, igual que `AskUserQuestion`/las preguntas del tablero (`Preguntas.tsx`, `preguntas.ts`): el turno devuelve un bloque `PREGUNTA` y el moderador pausa el debate hasta que Ferox contesta (o lo salta).
6. **Cierre**: la conclusión conjunta llega al líder igual que la revisión de la etapa 1: se niega el `ExitPlanMode` pendiente y se manda un mensaje con marca `[[debate-de-plan …]]` (el mismo mecanismo de `revision-plan-texto.ts`) que la ventana dibuja como tarjeta; el líder rehace el plan y lo presenta.

## Protocolo de turnos

- Rondas de 1 a 3 (default 2). En cada ronda habla cada participante una vez, en orden fijo (el primero es el de más cupo).
- Ronda 1, cada uno recibe: pedido original, plan del líder, rutas. Rondas siguientes: además, la transcripción de lo dicho (sólo texto, recortado a ~6000 caracteres por participante).
- Formato de cada turno (parseable, como las cuatro secciones de la etapa 1): `## Postura` (`acuerdo` | `cambio` | `pregunta`), `## Argumento` (≤ 150 palabras), `## Plan propuesto` (sólo si hay cambio), `## Pregunta para Ferox` (sólo si hace falta, con 2–4 opciones `- opción`).
- Máximo 3 turnos por modelo (tope duro, también con preguntas).

## Cómo se corta

- **Acuerdo total:** si en una ronda completa todos dicen `acuerdo` con el mismo plan propuesto (o ninguno propone cambios), se corta sin hacer la ronda siguiente.
- **Tope:** se llega a la ronda máxima o a 3 turnos por modelo.
- **Ferox:** botón «Cortar y concluir» (el moderador pide una conclusión a quien tenga más cupo con lo dicho hasta ahí) y «Cancelar» (no se manda nada al líder; el plan sigue pendiente).
- **Falla de un modelo** (sin cupo, error, vacío): se saca del debate con una línea visible; si queda uno solo, el debate pasa a ser una revisión simple.
- **Conclusión:** una llamada final, a cargo del participante con más cupo, con `## Acuerdos`, `## Desacuerdos que quedan`, `## Plan consensuado`.

## Cómo pregunta

Un turno con `## Pregunta para Ferox` pausa el moderador; la ventana muestra la pregunta con un botón por opción (más «Elegí vos»); la respuesta entra como un renglón más de la transcripción («Ferox: …»). Una pregunta por ronda como mucho; sin respuesta en 10 min se sigue sin ella y queda dicho.

## Costo y cupo

- Peor caso: 3 modelos × 3 turnos + conclusión = 10 llamadas, cada una con plan + transcripción (~2–8 mil tokens de entrada). Antes de empezar la tarjeta muestra el peor caso en llamadas y qué proveedores gasta.
- Cupo vía `reparto --cupos`: no se admite un modelo sin cupo (se ve gris, como en `SeguirCon`); se prefiere repartir entre proveedores distintos (Google y Claude) para no vaciar uno. Si un proveedor llega a su tope a mitad del debate, ese modelo se saca.
- Nada de `ANTHROPIC_API_KEY`, ni rotar cuentas para esquivar límites.

## Qué hay que implementar

`debate.ts` (+ `debate-texto.ts` puro para el parseo, como `revision-plan-texto.ts`), canales `debate:iniciar`, `debate:responder`, `debate:cancelar` y el aviso `debate:turno` (contrato, `preload.cts`, `puente.ts`, `maquinas-contrato.ts`, `windows/src/canales.json` con `node scripts/generar-canales.mjs`), `TarjetaDebate.tsx`, textos es/en, tests con modelos simulados (corte por acuerdo, tope, pregunta, falla de un modelo) y capturas de la tarjeta en vivo y de la pregunta.


## Lo implementado (2026-11-16)

- **Moderador** `app/electron/debate.ts` (+ `debate-texto.ts` puro) y **cableado** `app/electron/debate-trabajo.ts` (`crearDebates`: uno por líder, estado, responder, cortar, cancelar, descartar). Lo arma `lider.ts` (`debatesDe`): valida plan pendiente, modelos permitidos y esfuerzos prendidos, guarda la conclusión en `revisiones-pendientes.json` hasta que entra por la cola y la quita al entregarla.
- **Canales:** `debate:iniciar`, `debate:estado`, `debate:responder`, `debate:cortar`, `debate:cancelar`, `debate:descartar` (invoke) y el aviso `debate:turno` (en `EVENTOS` como «local»; también en `windows/src/canales.json`).
- **Ventana:** interruptor «Debate» en `SeguirCon.tsx` (2 o 3 modelos, esfuerzo por modelo con `esfuerzo-revisor.ts`, rondas 1 a 3, default 2, peor caso en llamadas), `TarjetaDebate.tsx` (en vivo, con «Ver la tarjeta») y `TarjetaConclusionDebate` (la conclusión que llega al chat con la marca `[[debate-de-plan …]]`). Estado de la ventana: `debate-vivo.ts`; lógica: `debate-logica.ts`.
- **Tests:** `tests/debate.test.ts` (moderador; pregunta sin respuesta a los 10 min con `mock.timers`, «Cortar y concluir»), `tests/debate-trabajo.test.ts` (iniciar → `debate:turno` → cierre con la marca entregada al líder), `tests/debate-vista.test.ts`.

### Supuestos que quedaron fijos

- En la ronda 1, el 2º y el 3º leen lo que dijo el 1º (la transcripción se arma turno a turno, no por ronda cerrada).
- La respuesta de Ferox entra a la transcripción como un renglón más («Ferox: …»), sin turno extra de nadie.
- Un plan propuesto idéntico (sin contar espacios ni mayúsculas) cuenta como acuerdo: corta el debate.
- Si queda un solo modelo (los demás fallaron), se cae a `revisarPlan` (revisión simple, tarjeta del revisor).
- «Cortar y concluir» no cuenta el turno en curso; «Cancelar» sólo vale hasta que empieza la entrega.

### Falta

- El orden por cupo (`cupo?` de `DepsDebate`) no se pasa todavía desde el main: hablan en el orden en que se eligieron.
- Capturas de la tarjeta en vivo y de la pregunta (no se pueden sacar en el sandbox).
