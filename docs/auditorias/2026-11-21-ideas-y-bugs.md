# Trama: bugs e ideas (auditoría del 2026-11-21)

Lista armada con auditorías de sólo lectura por área (cada una la hizo un modelo distinto) y con lo que se vio trabajando.
Un hallazgo «pendiente» todavía no lo comprobó nadie más que su autor: antes de arreglarlo hay que abrir el archivo y la línea.
El contexto y los tokens tienen su propio documento: `docs/auditorias/2026-11-21-contexto-y-tokens.md`.

## Resumen

- **Bugs: 158** (32 de severidad alta, 81 media, 45 baja).
  - arreglado: 126
  - refutado: 14
  - pendiente: 13
  - arreglado a medias: 5
- **Ideas: 102**.

| Área | Bugs | Arreglados | Pendientes |
|---|---|---|---|
| Barra lateral y datos | 18 | 17 | 0 |
| Debate y revisión de planes | 14 | 13 | 0 |
| El hilo: la caja y el líder en la ventana | 14 | 11 | 0 |
| Hooks y motor | 16 | 8 | 0 |
| Núcleo y canales | 14 | 13 | 0 |
| El CLI de `pa` | 15 | 15 | 0 |
| Puentes a otros motores | 20 | 19 | 1 |
| Reparto y cupos | 15 | 15 | 0 |
| Sistema: instalación, actualización y servicio | 16 | 15 | 1 |
| Vistos trabajando esta noche | 16 | 5 | 11 |

## Bugs

### Barra lateral y datos

**B001 · `planDiaValido` borra todas las fechas de ausencia por escape simple en `RegExp`** (`BARRA-DATOS-1`, severidad alta) · **ARREGLADO**
- Dónde: [app/src/datos/fuente.ts:1362-1368](file://app/src/datos/fuente.ts#L1362-L1368) (`planDiaValido`), llamado desde `planDia`…

**B002 · `desdeDisco` convierte a `NaN` los IDs de pendientes remotos (`"servidor:12"`)** (`BARRA-DATOS-2`, severidad alta) · **ARREGLADO**
- Dónde: [app/src/datos/tocado.ts:53-60](file://app/src/datos/tocado.ts#L53-L60) (`desdeDisco`), en cruce con…

**B003 · Reabrir un chat desde el historial lo deja oculto si antes se cerró con settle (`SETTLE`)** (`BARRA-DATOS-3`, severidad alta) · **ARREGLADO**
- Dónde: [app/src/barra/Barra.tsx:878-890](file://app/src/barra/Barra.tsx#L878-L890) (`abrirClaude`),…

**B004 · `visiblesDe` nunca recibe `recientes`, rompiendo orden, límites y Subir/Bajar al reordenar** (`BARRA-DATOS-4`, severidad alta) · **ARREGLADO**
- Dónde: [app/src/barra/Barra.tsx:304-312](file://app/src/barra/Barra.tsx#L304-L312) (`visiblesDe`), llamado en [Barra.tsx:1800](file://app/src/barra/Barra.tsx#L1800),…

**B005 · `congelada` bloquea la actualización de `ordenProyectos.current` tras reordenar desde la lista** (`BARRA-DATOS-5`, severidad alta) · **ARREGLADO**
- Dónde: [app/src/barra/Barra.tsx:618](file://app/src/barra/Barra.tsx#L618), [643-648](file://app/src/barra/Barra.tsx#L643-L648) y…

**B006 · `armarArrastre` impide arrastrar un líder único a otra carpeta** (`BARRA-DATOS-6`, severidad media) · **ARREGLADO**
- Dónde: [app/src/barra/arrastre.ts:44-45](file://app/src/barra/arrastre.ts#L44-L45) (`armarArrastre`)

**B007 · En modo `"recientes"` intercalado, el arrastre y Subir/Bajar saltan vecinos y desarman el intercalado** (`BARRA-DATOS-7`, severidad media) · **REFUTADO**
- Dónde: [app/src/barra/riel-logica.ts:112-118](file://app/src/barra/riel-logica.ts#L112-L118) (`filasCarpeta`) y [app/src/barra/Barra.tsx:1854-1856,…

**B008 · `Menu` conserva el `filtro` al volver desde `"Mover a proyecto…"` y oculta todas las acciones del menú** (`BARRA-DATOS-8`, severidad media) · **ARREGLADO**
- Dónde: [app/src/barra/Menu.tsx:83-87](file://app/src/barra/Menu.tsx#L83-L87) (`Menu`)

**B009 · `nuevaEn.current` no se limpia al cambiar de chat y secuestra la carpeta al ramificar otro hilo** (`BARRA-DATOS-9`, severidad media) · **ARREGLADO**
- Dónde: [app/src/barra/Barra.tsx:1125-1130](file://app/src/barra/Barra.tsx#L1125-L1130) (`liderCreado`)

**B010 · En `AvisoClaude`, `act.fase === "error"` pisa `fase = "actualizando"` y deja el botón habilitado al reintentar** (`BARRA-DATOS-10`, severidad media) · **ARREGLADO**
- Dónde: [app/src/barra/AvisoClaude.tsx:78-88](file://app/src/barra/AvisoClaude.tsx#L78-L88), [202-209](file://app/src/barra/AvisoClaude.tsx#L202-L209) y…

**B011 · `AvisoSetup` y `Reporte` traban el formulario/botón para siempre si el IPC rechaza** (`BARRA-DATOS-11`, severidad media) · **ARREGLADO**
- Dónde: [app/src/barra/AvisoSetup.tsx:36-44](file://app/src/barra/AvisoSetup.tsx#L36-L44) (`revisar`) y…

**B012 · `useUso` borra los datos previos preservados al recibir `null`/error por suscripción y tiene carrera en el arranque** (`BARRA-DATOS-12`, severidad media) · **ARREGLADO**
- Dónde: [app/src/barra/useUso.ts:39-62](file://app/src/barra/useUso.ts#L39-L62) y [75-94](file://app/src/barra/useUso.ts#L75-L94) (`arrancar` y `releerUso`)

**B013 · `lineasCuentas` muestra el reinicio de 5 h aunque la semana también esté al 100%, y `filaDe` redondea `99.6` a `100%`** (`BARRA-DATOS-13`, severidad media) · **ARREGLADO**
- Dónde: [app/src/barra/cupos-riel-logica.ts:136-156](file://app/src/barra/cupos-riel-logica.ts#L136-L156) (`lineasCuentas`) y…

**B014 · `Riel` y `LogoCab` no manejan `onError` en la imagen del proyecto y muestran ícono roto** (`BARRA-DATOS-14`, severidad media) · **ARREGLADO**
- Dónde: [app/src/barra/Riel.tsx:85](file://app/src/barra/Riel.tsx#L85) (`Riel`) y [app/src/barra/Logo.tsx:92](file://app/src/barra/Logo.tsx#L92) (`LogoCab`), comparado…

**B015 · `proyectos.ts` traga fallos IPC devolviendo `[]` y sufre carrera en recargas concurrentes** (`BARRA-DATOS-15`, severidad media) · **ARREGLADO**
- Dónde: [app/src/datos/proyectos.ts:143-146](file://app/src/datos/proyectos.ts#L143-L146) (`conMain.lista`) y [209-215](file://app/src/datos/proyectos.ts#L209-L215)…

**B016 · `Acople` desmonta `AvisoVuelta` al angostar o cerrar la barra y pierde el aviso de rollback de un solo uso** (`BARRA-DATOS-16`, severidad media) · **ARREGLADO**
- Dónde: [app/src/barra/Acople.tsx:654-658](file://app/src/barra/Acople.tsx#L654-L658) y…

**B017 · `altoFila` mide el primer `.w` sin excluir `.sub` ni `.pliegue`, corrompiendo el scroll virtualizado** (`BARRA-DATOS-17`, severidad baja) · **ARREGLADO**
- Dónde: [app/src/barra/ventana.ts:48-54](file://app/src/barra/ventana.ts#L48-L54) (`altoFila`)

**B018 · `promptRetomar` interpola `d.ruta` sin comillas en el comando `git -C`** (`BARRA-DATOS-18`, severidad baja) · **ARREGLADO**
- Dónde: [app/src/datos/retomar.ts:42-45, 64](file://app/src/datos/retomar.ts#L42-L45) (`promptRetomar`)

### Debate y revisión de planes

**B019 · El plan mejorado se rompe si trae títulos como «Riesgos» o «Cambios»** (`DEBATE-REVISION-1`, severidad alta) · **ARREGLADO**
- Qué pasa: Si el «Plan mejorado» del revisor tiene un subtítulo como `## Riesgos` o `### Cambios`, el parser lo toma como sección nueva. Se pierde la lista real de riesgos y el plan queda cortado. El líder recibe un mensaje deformado.
- Dónde: `app/electron/revision-plan-texto.ts` líneas 139-145 (`parsearRevision`)
- Arreglo: Reconocer cada sección una sola vez y sólo en el orden pedido. Después de «Plan mejorado» (la última), no reconocer más encabezados. Test en `tests/revision-plan.test.ts` con ese caso.

**B020 · Un plan con «Plan de pruebas» se corta en el turno y en la conclusión del debate** (`DEBATE-REVISION-2`, severidad alta) · **ARREGLADO**
- Qué pasa: En «Plan propuesto» o «Plan consensuado», un subtítulo como `### Plan de migración` o `## Plan de pruebas` reinicia la sección. Queda sólo lo que sigue a ese subtítulo. El líder recibe un plan consensuado truncado. La comparación de acuerdo (`acuerdoTotal`) también usa ese plan truncado.
- Dónde: `app/electron/debate-texto.ts` líneas 117-123 (`partir`), alias en 104 y 301
- Arreglo: Igual que el bug 1: sección única, en orden, y una vez abierta la última no se reabre. Test en `tests/debate.test.ts`.

**B021 · Al cancelar o dar timeout en Linux sobreviven los procesos hijos del revisor** (`DEBATE-REVISION-3`, severidad media) · **ARREGLADO**
- Qué pasa: Cancelar o pasar los 10 minutos deja vivos los hijos de `claude`, `agy` o `codex` (comandos, servidores MCP). Si el proceso ignora SIGTERM, no hay SIGKILL y queda vivo también.
- Dónde: `app/electron/revision-plan.ts` líneas 185 y 197-200 (`ejecutar`), con `app/electron/procesos.ts` líneas 28-40 (`matarArbol`)
- Arreglo: `detached: hijoEnGrupo()` en el spawn y SIGKILL a los pocos segundos si no cerró. Test con `matarArbol` inyectado.

**B022 · Cancelar durante la conclusión llena el debate de líneas «salió del debate» falsas** (`DEBATE-REVISION-4`, severidad media) · **ARREGLADO**
- Qué pasa: Al cancelar mientras se escribe la conclusión, la lista muestra «X salió del debate: Debate cancelado…» por cada participante restante. El rechazo final es «ningún modelo pudo escribir la conclusión», no «cancelado».
- Dónde: `app/electron/debate.ts` líneas 325-337
- Arreglo: Al inicio del `catch`, `if (cancelada.signal.aborted) throw e;`. Test en `tests/debate.test.ts`.

**B023 · Se puede lanzar una revisión simple con un debate vivo en el mismo líder** (`DEBATE-REVISION-5`, severidad media) · **ARREGLADO**
- Qué pasa: El debate sí rechaza si hay revisión corriendo, pero la revisión no mira si hay debate. Por IPC, o desde otra ventana, pueden correr las dos a la vez. Las dos niegan el plan y mandan dos mensajes al líder.
- Dónde: `app/electron/lider.ts` líneas 2298-2311 (`revisarPlanLider`); la guarda inversa está en 2342
- Arreglo: En `revisarPlanLider`, `if (debates.viva(sid)) throw errorT("main.revisionYaCorre")`. Test en `tests/revision-plan.test.ts` o `debate-trabajo.test.ts`.

**B024 · Una revisión vieja guardada sin entregar reaparece y se puede entregar por error** (`DEBATE-REVISION-6`, severidad media) · **ARREGLADO**
- Qué pasa: Si una revisión salió pero falló la entrega (queda guardada, «Reintentar») y la persona lanza otra, la vieja queda en `revisiones-pendientes.json` para siempre. Tras reiniciar, `estado()` devuelve `.at(-1)` y puede mostrar la vieja. «Reintentar» le entregaría al líder la revisión de un plan viejo.
- Dónde: `app/electron/revision-trabajo.ts` líneas 71-73 y 134-149 (`iniciar`, `reintentar`)
- Arreglo: Al iniciar, descartar las pendientes del mismo sid (o rechazar mientras haya una reintentable). En `reintentar`, rechazar si la fase es viva.

**B025 · Lectura y escritura sin candado del archivo compartido de pendientes** (`DEBATE-REVISION-7`, severidad media) · **ARREGLADO**
- Qué pasa: Dos líderes con revisión o debate a la vez comparten `ARCHIVO_REVISIONES`. Cada uno lee la lista, le suma o resta lo suyo y escribe. El último pisa al otro, y se pierde una revisión guardada sin entregar, que es justo lo que el archivo debía evitar.
- Dónde: `app/electron/lider.ts` líneas 2371-2376 (`guardar`/`entregar` del debate); `revision-trabajo.ts` líneas 95-99 y 104-107
- Arreglo: Una cadena de promesas (mutex) para toda modificación de ese archivo.

**B026 · Los planes propuestos se cortan a 6000 caracteres en lo que ven los demás modelos** (`DEBATE-REVISION-8`, severidad media) · **ARREGLADO**
- Qué pasa: `PLAN_MAX` permite planes de 60 000 caracteres y cada modelo devuelve su plan completo. En el prompt cada turno entra con máximo 6000 caracteres, cortado por el final. Los demás y quien concluye ven el plan propuesto sin su cola.
- Dónde: `app/electron/debate-texto.ts` líneas 17, 212-230 (`transcripcionParaPrompt`), 196-206 (`textoDeTurno`)
- Arreglo: Subir el tope del plan (o dar tope aparte al plan y al argumento) y recortar el argumento antes que el plan.

**B027 · Los archivos que se le pegan a Gemini pueden salir de la carpeta o ser secretos** (`DEBATE-REVISION-9`, severidad media) · **ARREGLADO**
- Qué pasa: La guarda de «nunca fuera de `cwd`» es sólo de texto: un enlace simbólico dentro del proyecto hacia otro lugar se lee y se manda a Google. La lista de exclusión (`.env*`, `claves*`, `.git`, `node_modules`) no cubre `credentials.json`, `secrets.*`, `*.pem` ni `id_rsa`.
- Dónde: `app/electron/revision-plan.ts` líneas 84-96 (`archivosDelPlan`)
- Arreglo: `realpath` y volver a comprobar que queda dentro; ampliar la lista de nombres sensibles.

**B028 · El orden por cupo del debate nunca se usa** (`DEBATE-REVISION-10`, severidad baja) · **ARREGLADO**
- Qué pasa: El código y la documentación dicen que habla primero y concluye «quien tenga más cupo». Pero `debatesDe` no pasa `cupo`, así que el orden es siempre el de elección. Concluye el primero elegido aunque tenga el cupo agotado.
- Dónde: `app/electron/debate.ts` líneas 44, 103-106 y 319; `lider.ts` líneas 2357-2378
- Arreglo: Pasar `cupo` desde `estadosCupoModelos` o el uso guardado, o quitar la promesa del texto.

**B029 · «(sin nada que decir)» se ve en español en la tarjeta en inglés** (`DEBATE-REVISION-11`, severidad baja) · **ARREGLADO**
- Qué pasa: Con una sección vacía, el mensaje al líder lleva el texto literal «(sin nada que decir)». Al releerlo, la tarjeta lo trata como contenido (es verdadero) y muestra el literal en español, no «Nothing to add». Si «Plan mejorado» viene vacío, se dibuja el desplegable con ese literal.
- Dónde: `app/electron/revision-plan-texto.ts` línea 160; `app/electron/debate-texto.ts` líneas 323, 326, 329; se lee en `TarjetaRevision.tsx` línea 42 y `TarjetaDebate.tsx` línea 365
- Arreglo: Tratar ese literal como vacío al leer.

**B030 · Si Claude llega al tope de 12 turnos, se descarta lo escrito y el error es una clave cruda** (`DEBATE-REVISION-12`, severidad baja) · **ARREGLADO**
- Qué pasa: Un revisor que lee varios archivos puede agotar los 12 turnos. La persona ve «Claude no pudo terminar la revisión: error_max_turns», y el texto parcial se tira.
- Dónde: `app/electron/revision-plan.ts` líneas 276-308 (`--max-turns 12`), `revision-flujo.ts` línea 67
- Arreglo: Mapear `error_max_turns` a un texto traducido y, si hay texto con las secciones, usarlo.

**B031 · Con un error al pedir revisores, la interfaz supone que todos los modelos están conectados** (`DEBATE-REVISION-13`, severidad baja) · **REFUTADO**
- Qué pasa: Si `liderRevisores` falla, la lista cae a todos los modelos de `MODELOS`. Aparecen Claude, Gemini y ChatGPT aunque falten sesiones o estén desactivados. Recién al elegir sale «no se puede usar de revisor».
- Dónde: `app/src/hilo/Lider.tsx` línea 2181
- Arreglo: Dejar la lista vacía con un aviso, o repetir el pedido.

**B032 · La columna del modelo que habla dice «Espera su turno» hasta su primer paso** (`DEBATE-REVISION-14`, severidad baja) · **ARREGLADO**
- Qué pasa: Al empezar un turno se pone `p.vivo` pero no se emite. Hasta el primer avance, que en Gemini puede tardar, la columna sigue en «Espera su turno». En la conclusión, la columna ya tiene su turno de esa ronda y nunca muestra «Escribiendo»: sólo se ve el texto «Escribiendo la conclusión…».
- Dónde: `app/electron/debate.ts` líneas 191-193 (`llamar`); `app/src/hilo/debate-logica.ts` líneas 93-97
- Arreglo: `emitir(null)` al crear `vivo`, y decidir el estado «escribiendo» antes de la rama del turno ya dicho si `p.vivo`.

### El hilo: la caja y el líder en la ventana

**B033 · El efecto de `modeloServidor` pisa lo que la persona eligió después** (`HILO-LIDER-1`, severidad media) · **ARREGLADO**
- Qué pasa: Si la lista del servidor llega con un modelo nuevo justo después de que la persona eligió otro (o otro esfuerzo) en la caja, la caja vuelve al modelo del servidor. La elección se pierde, y el efecto de la línea 476 manda el valor pisado a la cola, así que el main también se queda con el viejo.
- Dónde: `app/src/hilo/Lider.tsx` líneas 457-466 (efecto de `modeloServidor`)
- Arreglo: seguir al servidor solo si la caja seguía igual al valor anterior del servidor: `setModelo((m) => (m === vistoAntes ? modeloServidor : m))`, y lo mismo con el esfuerzo. Test: una función pura `seguirServidor(caja, anterior, nuevo)`.

**B034 · «Seguir con otro modelo» y «Revisar con otro modelo» pierden la fila resaltada cuando el padre se repinta** (`HILO-LIDER-2`, severidad media) · **ARREGLADO**
- Qué pasa: Con el diálogo de revisión abierto, cada repintado de `ChatLider` hace que la fila marcada con las flechas vuelva a la preferida. Además se vuelve a llamar a `fuente.cuentas()`.
- Dónde: `app/src/hilo/Lider.tsx` líneas 2272-2278 (`PedidoPermiso`) y `app/src/hilo/SeguirCon.tsx` líneas 89-96 y 102-105
- Arreglo: `useMemo` de `opciones` por `[revisores, tablaModelos]` y `useCallback` para `esfuerzos` en `PedidoPermiso`. En `SeguirCon`, resetear la resaltada solo si cambia la lista de ids o la búsqueda, no la identidad de `filas`.

**B035 · Tras «Compactar y seguir» desde la caché vencida se borra lo que la persona escribió mientras tanto** (`HILO-LIDER-3`, severidad media) · **ARREGLADO**
- Qué pasa: El mensaje queda en la caja mientras compacta, y la caja sigue editable porque `enviando` es false. Si la persona lo corrige o escribe otra cosa, al terminar se manda el texto viejo `pend.crudo` y `salir` hace `setTexto("")`, así que los cambios se pierden.
- Dónde: `app/src/hilo/Lider.tsx` líneas 1406-1410 (efecto de `compactoCache`) y 1149 (`salir`)
- Arreglo: poner la caja en solo lectura mientras `compactoCache` esté activo (`readOnly={enviando || !!compactoCache}`), o mandar `texto` actual si difiere. Test: `siguienteCambio`/efecto con un texto cambiado.

**B036 · Si falla la lectura de pedidos pendientes, un plan o permiso queda invisible y no se reintenta** (`HILO-LIDER-4`, severidad media) · **ARREGLADO**
- Qué pasa: Con la ventana recargada, un fallo de `liderPendientes` deja sin mostrar el «Plan listo» o el permiso que el líder espera. El líder queda parado y no hay forma de volver a pedirlo.
- Dónde: `app/src/hilo/vivo.ts` líneas 395-397 (`suscribir`)
- Arreglo: `.catch(() => rehidratados.delete(sid))`, para que la próxima suscripción lo pida de nuevo.

**B037 · El aviso de «cambiar de modelo con caché viva» sigue en pantalla, sin texto, cuando la caché ya venció** (`HILO-LIDER-5`, severidad baja) · **REFUTADO**
- Qué pasa: Al vencer la caché, el reloj del aviso se vacía (`texto: ""`), pero la franja con «Volver a X» y «Compactar y cambiar» sigue hasta el próximo repintado. Ofrece compactar cuando ya no hay caché que cuidar.
- Dónde: `app/src/hilo/Lider.tsx` líneas 1455-1462 (`cambia`) y 1966-1989; `app/src/hilo/Turno.tsx` líneas 34-44 (`pintorAviso`)
- Arreglo: un `setTimeout` hasta `cache_vence` que fuerce el repintado, o mover la condición al pintor para que no renderice la franja.

**B038 · Un cambio de esfuerzo hecho en otro lado no llega a la caja** (`HILO-LIDER-6`, severidad baja) · **ARREGLADO**
- Qué pasa: Si el esfuerzo del líder cambia desde otra ventana o `/effort` sin que cambie el modelo, la caja conserva el esfuerzo viejo. «Volver/Editar» y los envíos mandan el viejo, y durante un turno aparece «próx.» con el esfuerzo viejo.
- Dónde: `app/src/hilo/Lider.tsx` línea 461
- Arreglo: separar un efecto de esfuerzo con su propio `vistoEffort`, con la misma regla de HILO-LIDER-1 para no pisar lo que la persona tocó.

**B039 · El menú de `/model` y «Seguir con otro modelo» no se refrescan cuando cambia la tabla de modelos** (`HILO-LIDER-7`, severidad baja) · **ARREGLADO**
- Qué pasa: Tras cambiar el catálogo (Ajustes, proveedor nuevo), el segundo nivel de `/model` muestra modelos viejos y `SeguirCon` no recalcula su lista.
- Dónde: `app/src/hilo/Lider.tsx` líneas 501-511 (`valores`) y 1907; `app/src/hilo/opciones.tsx` línea 83
- Arreglo: agregar `tablaModelos` a las dependencias de `valores`, y pasar a `SeguirCon` una copia (`[...MODELOS]`) memoizada por `tablaModelos`.

**B040 · Sin transcript cargado, la pregunta de caché vencida cuenta 0 tokens y deja pasar el mensaje** (`HILO-LIDER-8`, severidad baja) · **ARREGLADO**
- Qué pasa: Si la persona manda antes de que cargue el transcript y todavía no hay uso del stream, `tokens = 0`. `decidirCache` responde «enviar» por ser menor que `UMBRAL_TOKENS`, y el mensaje relee todo el contexto sin avisar.
- Dónde: `app/src/hilo/Lider.tsx` líneas 1006-1022 (`veredictoCache`); `app/src/hilo/contexto-logica.ts` líneas 43-44
- Arreglo: si `pag` es null, esperar a la lectura o decidir con `l.usage` si existe. Test: `decidirCache` con tokens desconocidos.

**B041 · El espejo de la cola descarta el error cuando la lista queda vacía** (`HILO-LIDER-9`, severidad baja) · **ARREGLADO**
- Qué pasa: Un aviso con `error` y sin items en `lista` ni `camino` borra el estado del líder, y el motivo del fallo se pierde.
- Dónde: `app/src/hilo/cola.ts` líneas 26-30 (`poner`)
- Arreglo: conservar la entrada si `a.error`, o documentar que nunca ocurre. Test en `tests/` del espejo.

**B042 · La preferencia de caché vencida queda fija si falla su lectura** (`HILO-LIDER-10`, severidad baja) · **ARREGLADO**
- Qué pasa: Si `fuente.cacheVencida()` falla, `valor` queda en «preguntar» y no se vuelve a leer. Lo que la persona recordó se ignora hasta reiniciar, y el rechazo queda sin manejar.
- Dónde: `app/src/hilo/cache-eleccion.ts` líneas 11-22
- Arreglo: `.catch(() => { leido = false; })`.

**B043 · «Compactar» del panel de contexto puede quedar trabado en «compactando» para siempre** (`HILO-LIDER-11`, severidad baja) · **REFUTADO**
- Qué pasa: Si la marca de `useCompactando` nunca se baja (se cae el hook, o el proceso muere a mitad), la fase queda en `compactando`. `puede` es false (`fase === "reposo"`) y el botón no vuelve.
- Dónde: `app/src/hilo/compactar.ts` líneas 29 y 55-64
- Arreglo: un tope (por ejemplo 15 min) que vuelva a `reposo` con una nota de error.

**B044 · Si falla la lista de revisores, se ofrecen todos los modelos como si todo estuviera conectado** (`HILO-LIDER-12`, severidad baja) · **ARREGLADO**
- Qué pasa: Con `liderRevisores` rechazado, el selector lista todos los de `MODELOS`, incluidos proveedores desactivados en Ajustes o sin conectar. La persona puede elegir uno y la revisión falla después.
- Dónde: `app/src/hilo/Lider.tsx` línea 2181
- Arreglo: en el fallo, filtrar `!m.sinConectar` y mostrar un aviso de que no se pudo leer la lista.

**B045 · El aviso de «cerca del límite» confunde 1 % con 100 %** (`HILO-LIDER-13`, severidad baja) · **REFUTADO**
- Qué pasa: `uso === 1` se muestra como 100 %, aunque venga como «1 %». Con `uso` = 0,5 o 50 se interpreta bien, pero el valor 1 es ambiguo.
- Dónde: `app/src/hilo/Hace.tsx` línea 78 (`textoAviso`, clase `limite`)
- Arreglo: normalizar la escala en el main para que siempre llegue 0-1, o 0-100, y quitar la heurística.

**B046 · Textos desparejos entre español e inglés** (`HILO-LIDER-14`, severidad baja) · **ARREGLADO**
- Qué pasa: En español dice «{pct} %» y en inglés «{pct}%». En inglés el mismo concepto sale como «lead» en `lider.nuevo` y como «leader» en `lider.atFallo` y en `ctxp.*`. Las variables coinciden, así que no rompe nada.
- Dónde: `app/src/i18n/es.ts` líneas 1682 y 1722, y `app/src/i18n/en.ts` líneas 1694 y 1734 (`ctxp.pctVentana`, `ctxp.mapaBloque`); `en.ts` línea 101 contra 1163 (`lider.nuevo` y `lider.atFallo`)
- Arreglo: unificar el espaciado y elegir «lead» o «leader» en todo `en.ts`.

### Hooks y motor

**B047 · Leer un enlace permite salir del worktree** (`HOOKS-MOTOR-1`, severidad alta) · **REFUTADO**
- Qué pasa: un worker remoto puede leer un archivo ajeno al proyecto mediante un enlace simbólico que está dentro del worktree. El contenido queda disponible para enviarlo al proveedor aunque el hook prometa impedir esa lectura.
- Dónde: `motor/hooks/agy-pa.mjs` línea 446 (validación de argumentos de lectura).
- Arreglo: resolver el destino real de cada argumento de lectura antes de compararlo con las carpetas permitidas, como se hace para escribir; usar también esa validación para Cwd y las rutas explícitas de comandos. Agregar una prueba con un enlace a un archivo externo y otra con un enlace interno permitido; en Windows cubrir…

**B048 · Una guardia hija rota deja pasar la herramienta** (`HOOKS-MOTOR-2`, severidad alta) · **REFUTADO**
- Qué pasa: si destructive-guard o latido falta, falla o no puede arrancar, agy permite el comando. Se pierden las restricciones de borrado, git, builds o lectura sin mostrar un error a la persona.
- Dónde: `motor/hooks/agy-pa.mjs` línea 164 (PreToolUse; también línea 529).
- Arreglo: conservar `error`/`signal` y denegar cualquier resultado que no sea una ejecución exitosa de la guardia, con un motivo que identifique el módulo. Agregar pruebas para código 1, `ENOENT`, señal y código 2 en ambas guardias; ninguna debe permitir la herramienta.

**B049 · Los bloqueos copian valores privados a stderr** (`HOOKS-MOTOR-3`, severidad alta) · **ARREGLADO**
- Qué pasa: un comando que lleva una credencial o un dato privado como argumento o asignación se copia al error del hook. El bloqueo evita ejecutar el comando, pero conserva ese dato en la salida de error y se lo devuelve al modelo.
- Dónde: `motor/hooks/destructive-guard.mjs` línea 223 (mensaje de bloqueo).
- Arreglo: sacar el comando crudo de los mensajes del hook y mostrar sólo la regla que bloqueó; si se necesita contexto, usar una descripción que no incluya argumentos ni asignaciones. Cubrir los tres mensajes del guard y el de Docker con una prueba que asegure que un marcador privado no aparece en stdout ni stderr.

**B050 · Compose queda sin revisar en una instalación sin yaml** (`HOOKS-MOTOR-4`, severidad media) · **ARREGLADO**
- Qué pasa: `docker compose up` puede arrancar un servicio con `privileged: true` o montajes del host sin que la guardia advierta nada. La instalación normal no garantiza el módulo necesario para revisar el archivo.
- Dónde: `motor/hooks/docker-guard.mjs` línea 688 (`revisarComposeArchivos`).
- Arreglo: distribuir un parser YAML resoluble desde los hooks en Linux y Windows y, si falta, rechazar los verbos de Compose que crean contenedores con un mensaje explícito. Probar el YAML privilegiado con parser y el mismo comando en un payload sin parser.

**B051 · El runner no puede lanzar el shim de npm en Windows** (`HOOKS-MOTOR-5`, severidad media) · **REFUTADO**
- Qué pasa: un worker de OpenCode falla al arrancar si la instalación encontrada es `opencode.cmd`, aun cuando el chequeo previo lo haya encontrado correctamente.
- Dónde: `motor/opencode/correr.mjs` línea 192 (`main`; también línea 183).
- Arreglo: adaptar el binario y sus argumentos para Windows antes de las dos llamadas, usando el equivalente de `paraLanzar` o resolver el ejecutable real del paquete. Probar un shim `.cmd` ubicado en una ruta con espacios que sólo devuelva ayuda y eventos falsos, sin conectar un modelo.

**B052 · OpenCode guarda sus datos fuera del estado nativo de Windows** (`HOOKS-MOTOR-6`, severidad media) · **REFUTADO**
- Qué pasa: al ejecutar el motor desde una terminal de Windows sin variables de rutas, los topes actualizados y pedidos de OpenCode quedan en carpetas distintas de las que lee Trama. El plan puede caer en «gratis» aunque se haya configurado Go en la app.
- Dónde: `motor/opencode/go-topes.mjs` línea 29 (`rutaCache`).
- Arreglo: unificar en los módulos del motor los defaults por plataforma y pasar también las rutas calculadas al runner desde TS. Cubrir los tres destinos con rutas Windows sintéticas y los overrides de entorno; no mezclar disco temporal real de Linux con plataforma Windows.

**B053 · La misma compactación devuelve dos veces la nota** (`HOOKS-MOTOR-7`, severidad media) · **REFUTADO**
- Qué pasa: si corren dos registros del hook para SessionStart, el contexto posterior a compactar recibe dos copias de la nota. Gastan espacio y pueden traer encabezados de antigüedad diferentes.
- Dónde: `motor/hooks/nota-compactar.mjs` línea 330 (`decidir`, SessionStart).
- Arreglo: crear una marca exclusiva de devolución por sid y compactación antes de consumir el archivo o consultar el transcript; una segunda ejecución de ese evento debe devolver null. Probar las dos llamadas consecutivas y simultáneas, y una segunda compactación legítima de la misma sesión.

**B054 · Un ejemplo de código se guarda como nota personal** (`HOOKS-MOTOR-8`, severidad media) · **ARREGLADO**
- Qué pasa: explicar cómo escribir una nota, mostrando sus etiquetas como código, puede reemplazar la nota verdadera por el texto del ejemplo. La sesión recibe ese ejemplo como si fuera su resumen al compactar.
- Dónde: `motor/hooks/nota-compactar.mjs` línea 167 (`extraerNotaDeTexto`).
- Arreglo: reconocer etiquetas fuera de código, con la misma semántica de la interfaz, y usar ese reconocimiento al extraer desde el transcript. Probar ejemplos inline, cercas, una nota real después de un ejemplo y una etiqueta de cierre citada dentro de la nota.

**B055 · Una línea grande oculta el contexto y la nota actuales** (`HOOKS-MOTOR-9`, severidad media) · **ARREGLADO**
- Qué pasa: un mensaje grande al final del transcript puede desactivar el pedido de nota justo cuando el contexto está lleno. Si la nota está en ese mismo registro, PreCompact tampoco la guarda.
- Dónde: `motor/hooks/nota-compactar.mjs` línea 104 (`leerColaTranscript`).
- Arreglo: buscar hacia atrás el comienzo de los registros necesarios con un límite explícito mayor y una estrategia para registros que exceden ese límite; obtener el uso de una fuente independiente cuando no se pudo recuperar el registro. Probar una línea assistant grande, una herramienta grande posterior y una nota dentro de…

**B056 · Leer git falla cuando la carpeta tiene espacios** (`HOOKS-MOTOR-10`, severidad media) · **REFUTADO**
- Qué pasa: un worker con `--leer` no puede ejecutar un `git -C` de lectura válido cuando la ruta lleva espacios entre comillas. El aviso le indica usar justamente `git -C`, pero esa forma sigue bloqueada.
- Dónde: `motor/hooks/latido.mjs` línea 141 (`gitDeLectura`).
- Arreglo: separar los argumentos con un parser que respete las comillas del shell correspondiente, conservando el rechazo de sustituciones, redirecciones y encadenamientos. Probar rutas con espacios, comillas escapadas y las mismas rutas en Windows.

**B057 · La privacidad corta una ruta permitida en el primer espacio** (`HOOKS-MOTOR-11`, severidad media) · **ARREGLADO**
- Qué pasa: un worker Gemini que escribe tampoco puede usar una ruta absoluta válida dentro de su worktree si la carpeta contiene espacios. Recibe un bloqueo de privacidad para una ruta que nunca pidió abrir.
- Dónde: `motor/hooks/agy-pa.mjs` línea 401 (`comandoSale`).
- Arreglo: conservar los argumentos citados al recorrer las rutas de un comando, con reglas de POSIX o Windows según la plataforma. Probar una raíz con espacios, un hijo de esa raíz y una ruta externa con el mismo prefijo; esta última debe seguir bloqueada.

**B058 · Un pid reciclado se toma como otro worker vivo** (`HOOKS-MOTOR-12`, severidad media) · **REFUTADO**
- Qué pasa: después de una caída que deja un `.running` viejo, la guardia puede bloquear la instalación de dependencias aunque ya no corra otro worker. Alcanza con que el número guardado ahora corresponda a un programa ajeno.
- Dónde: `motor/hooks/latido.mjs` línea 218 (`otroWriterVivo`).
- Arreglo: validar identidad y antigüedad del proceso antes de contarlo como writer; reutilizar o portar la lógica de `pidDeCampoRunning` al hook distribuido. Probar un proceso real anterior al archivo, uno posterior, un pid inexistente y el fallback a `pa_pid`.

**B059 · Se conserva sólo la última parte del resultado** (`HOOKS-MOTOR-13`, severidad media) · **ARREGLADO**
- Qué pasa: cuando la respuesta final tiene varias partes de texto, el JSON que recibe `pa` pierde todas salvo la última. Puede desaparecer RESULTADO, ARCHIVOS o una decisión, aunque estén en el transcript.
- Dónde: `motor/opencode/correr.mjs` línea 82 (`aResultado`).
- Arreglo: identificar el último paso con respuesta y concatenar sus partes de texto en orden, respetando si el protocolo entrega partes completas o actualizaciones de una misma parte. Probar una respuesta multipartes y otra con comentarios de pasos anteriores que no deben mezclarse con la respuesta final.

**B060 · Un turno sin texto queda marcado como exitoso** (`HOOKS-MOTOR-14`, severidad media) · **ARREGLADO**
- Qué pasa: OpenCode puede terminar sin entregar una respuesta y la corrida figura como buena, con resultado vacío. El jefe no recibe el informe esperado y las mediciones no registran el fallo.
- Dónde: `motor/opencode/correr.mjs` línea 91 (`aResultado`).
- Arreglo: exigir una respuesta final no vacía para marcar éxito en el runner de workers, o clasificar explícitamente el cierre sin texto como error. Probar ese caso, una respuesta sólo de razonamiento y una respuesta textual válida, tanto con step_finish final como sin él.

**B061 · Registrar el statusline de Windows agrega una dependencia de bash** (`HOOKS-MOTOR-15`, severidad media) · **REFUTADO**
- Qué pasa: instalar los hooks sobre un statusline propio que ya funciona en Windows lo reemplaza por un comando que requiere bash. Una instalación nativa sin ese programa pierde su statusline original.
- Dónde: `app/electron/cli/hooks.ts` línea 159 (`registrarEnAjustes`).
- Arreglo: envolver el statusline con el intérprete nativo correspondiente, usando argumentos y comillas compatibles con Windows; conservar bash sólo para la plataforma que ya lo usa. Probar registro y ejecución de un statusline propio desde una ruta con espacios en ambos sistemas, sin exigir bash en Windows.

**B062 · La cola descarta una línea que ya estaba completa** (`HOOKS-MOTOR-16`, severidad baja) · **ARREGLADO**
- Qué pasa: si el comienzo del tramo coincide exactamente con el inicio de una línea válida, se pierde ese registro igual. Puede ser el único que contiene el uso del contexto o la nota que hacía falta guardar.
- Dónde: `motor/hooks/nota-compactar.mjs` línea 102 (`leerColaTranscript`).
- Arreglo: leer también el byte anterior al offset y descartar la primera línea sólo cuando ese byte no sea un salto. Probar offset 0, offset alineado, offset dentro de una línea y archivos CRLF con el corte a ambos lados de `\r\n`.

### Núcleo y canales

**B063 · El PATH del usuario puede corromperse con acentos al agregar `bin\`** (`NUCLEO-IPC-5`, severidad alta) · **ARREGLADO**
- Qué pasa: si una entrada del PATH de usuario tiene caracteres no ASCII (`C:\Users\José\...`), el instalador la reescribe con caracteres rotos. Esa entrada deja de andar.
- Dónde: `windows/src/nativo.js` líneas 400-403 (`PS_LEER_PATH`), 386 (`correr`) y 433-437 (`agregar`)
- Arreglo: leer el valor en base64 (`[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($v))`) y decodificar en Node, o poner `[Console]::OutputEncoding=[Text.Encoding]::UTF8` antes. Lo mismo vale para `PS_LEER_RUN`.

**B064 · Buscar actualización a mano con un límite de GitHub congela el actualizador de Windows** (`NUCLEO-IPC-1`, severidad media) · **ARREGLADO**
- Qué pasa: si la persona toca «Buscar actualizaciones» y GitHub contesta 403/429, la fase queda en "buscando" para siempre. Todas las búsquedas siguientes salen sin hacer nada y Trama no se actualiza hasta reiniciar.
- Dónde: `windows/src/actualizar.js` líneas 75-78, 110-122 y 135 (`fallo`, `buscar`)
- Arreglo: en `fallo`, si `esLimite` y `fase === "buscando"`, hacer `decir({fase:"al-dia"})` o volver a la fase anterior.

**B065 · La confianza en la página se decide con `startsWith` sin separador** (`NUCLEO-IPC-2`, severidad media) · **ARREGLADO**
- Qué pasa: una URL como `http://localhost:8791.sitio-ajeno.com/` o `http://localhost:87910/` cuenta como la página de Trama. Recibe el preload con `carcasa.ventana`: `app:salir`, `archivo:abrir`, `carpeta:elegir`, `cuentas:login`. Si un link del chat navega la ventana a esa URL, se la deja pasar.
- Dónde: `windows/src/main.js` líneas 230-233 (`deConfianza`), 378-383 (`will-navigate`) y 386 (`did-fail-load`)
- Arreglo: una función `esPropio(u)` que haga `new URL(u).origin === MOTOR_URL` o `u.startsWith("file:")`, usada en las tres líneas. Test en `windows/tests`.

**B066 · «Volver a la versión anterior» puede cerrar Trama y no reabrirla** (`NUCLEO-IPC-6`, severidad media) · **ARREGLADO**
- Qué pasa: con un perfil de usuario con acentos, el guion `.cmd` lleva las rutas de `robocopy` y `start` mal leídas. Trama se cierra (`d.salir()`) y la versión anterior no se restaura ni se abre.
- Dónde: `windows/src/version-anterior.js` líneas 102-125 (`guionDeRestauracion`, `lanzarRestauracion`)
- Arreglo: agregar `chcp 65001 >nul` como segunda línea del guion, o rechazar rutas no ASCII en `SEGURA` y avisar antes de salir. Test: `guionDeRestauracion` con `José` debe empezar con `chcp`.

**B067 · Si el motor es «adoptado», Salir y Actualizar no lo paran** (`NUCLEO-IPC-7`, severidad media) · **ARREGLADO**
- Qué pasa: el menú de la bandeja dice «Salir (apaga el motor y los líderes)», pero con un motor adoptado (que quedó de una carcasa caída) no lo apaga. La actualización siguiente falla con «No pude reemplazar… otro programa los tiene abiertos», porque `node.exe` sigue corriendo.
- Dónde: `windows/src/nativo.js` líneas 236-248 (`parar`); `windows/src/pasos-nativo.js` línea 85
- Arreglo: en `parar()`, si la fase era "adoptado", leer el pid de `rutas.dueno` y llamar a `matarArbol`.

**B068 · «Reportar un bug» muestra el error de «cuentas» cuando falla** (`NUCLEO-IPC-3`, severidad baja) · **ARREGLADO**
- Qué pasa: si el main devuelve algo raro o sin `error`, la persona ve «El comando cuentas falló (código {rc})», con la `{rc}` sin reemplazar.
- Dónde: `app/src/datos/fuente.ts` línea 41 (`reporteValido`)
- Arreglo: una clave propia (por ejemplo `main.reporteFallo`) en `es.ts` y `en.ts` con las mismas variables, y usarla acá.

**B069 · `asistente:`, `actualizar:instalar` y `app:version` no pasan por `deConfianza`** (`NUCLEO-IPC-4`, severidad baja) · **ARREGLADO**
- Qué pasa: cualquier página con el preload puede pedir `actualizar:instalar` (cierra Trama e instala), `asistente:conectar` o `asistente:saltarLogin`. Sólo `actualizar:buscar` y `restos:*` están protegidos (435-438).
- Dónde: `windows/src/main.js` líneas 424-434
- Arreglo: envolver con `protegido` (o con `deConfianza`) todos los handlers de las líneas 424-434, menos `app:version` si hace falta.

**B070 · `agy:actualizar` se puede pedir por la tailnet** (`NUCLEO-IPC-8`, severidad baja) · **ARREGLADO**
- Qué pasa: desde el celular se puede disparar la actualización de `agy`. En Linux abre una terminal con `paru` en la PC; en Windows corre `agy update`. `claude:actualizar` sí está bloqueado.
- Dónde: `app/electron/nucleo.ts` línea 158 (`SOLO_PC_TAILNET`) y línea 1739
- Arreglo: agregar `"agy:actualizar"` y `"opencode:actualizar"` al `Set`. Test en `app/tests/nucleo.test.ts`.

**B071 · `lider:cerrar` vacía la cola antes de saber si el cierre anduvo** (`NUCLEO-IPC-9`, severidad baja) · **ARREGLADO**
- Qué pasa: si `lider.cerrar` falla, el líder sigue abierto pero los mensajes que esperaban en su cola ya se borraron.
- Dónde: `app/electron/nucleo.ts` líneas 1664-1669
- Arreglo: mover `cola.vaciar` después del `await lider.cerrar`.

**B072 · `salud:eventos` acepta 0, negativos y números enormes** (`NUCLEO-IPC-10`, severidad baja) · **ARREGLADO**
- Qué pasa: `dias = null`, `""` o `false` se convierte en 0 días y devuelve vacío en vez de los 7 por defecto. Un cliente por red puede pedir `1e9` días.
- Dónde: `app/electron/nucleo.ts` línea 1087
- Arreglo: `typeof dias === "number" && dias >= 1 ? Math.min(dias, 365) : 7`.

**B073 · `orq:auditar` revienta con `TypeError` si llega sin argumento** (`NUCLEO-IPC-11`, severidad baja) · **REFUTADO**
- Qué pasa: `x` indefinido tira «Cannot read properties of undefined». El resto del manejador usa `x?.`.
- Dónde: `app/electron/nucleo.ts` línea 1238
- Arreglo: `String(x?.proyecto)`.

**B074 · La carcasa de Windows acepta nombres como `constructor` o `toString` como proveedor de login** (`NUCLEO-IPC-12`, severidad baja) · **ARREGLADO**
- Qué pasa: `saltarLogin("toString")` pasa la guarda y guarda `loginSaltado.toString=true` en `estado.json`. `conectar("constructor")` intenta lanzar una consola con una función como programa y falla con un error confuso.
- Dónde: `windows/src/pasos-nativo.js` líneas 147, 162-165 y 178-182
- Arreglo: `Object.hasOwn(PROVEEDORES_LOGIN, proveedor)` en las dos guardas.

**B075 · Una segunda instancia que llega antes de `ready` rompe la carcasa** (`NUCLEO-IPC-13`, severidad baja) · **ARREGLADO**
- Qué pasa: si se abre Trama por segunda vez en el primer instante (por ejemplo mientras arranca con la sesión), `mostrarVentana()` llama a `arrancar()` antes de `app.whenReady`. Tira «Session can only be received when app is ready» y sale un diálogo de error del main.
- Dónde: `windows/src/main.js` línea 463, y 358-359 (`arrancar`)
- Arreglo: `app.whenReady().then(mostrarVentana)` dentro del handler, o una bandera `listo`.

**B076 · Algunos errores del main se muestran con prefijo técnico, y tres preferencias no tienen tope** (`NUCLEO-IPC-14`, severidad baja) · **ARREGLADO**
- Qué pasa: un `TypeError` del main llega como «TypeError: …» a la interfaz, porque la expresión sólo quita `Error: `. Aparte, `preferencias:effort` y `leidos:marcar` guardan cualquier cantidad de claves de cualquier largo. Por la tailnet, un cliente puede hacer crecer `preferencias.json` y `leidos.json` sin límite.
- Dónde: `app/src/puente.ts` líneas 620-621 (`mensaje`); `app/electron/preferencias.ts` líneas 198-203; `app/electron/leidos.ts` líneas 30-36
- Arreglo: regex `(?:\w*Error: )?`. En `guardarEffort`, aceptar sólo modelos conocidos o `modelo.length <= 100`. En `marcarLeido`, `id.length <= 200`.

### El CLI de `pa`

**B077 · El resumen de continuación esquiva el chequeo de secretos** (`PA-CLI-1`, severidad alta) · **ARREGLADO**
- Qué pasa: `--seguir-con` puede mandar a otro proveedor un secreto que estaba en la conversación anterior, aunque el pedido nuevo no lo contenga. La revisión de privacidad se hace sobre el texto corto, antes de agregar el resumen.
- Dónde: `app/electron/cli/pa/cli.ts` línea 475 (`correrPa`).
- Arreglo: volver a revisar el contenido final al reemplazar la tarea en la línea 475, antes de relanzar async o despachar el motor. El mismo control debe cubrir el resumen por caché frío y el worktree que realmente se retoma. Agregar un test que niegue el envío del dato ficticio aunque el pedido extra sea inocuo.

**B078 · Se reutiliza el puesto de un hijo que sigue vivo** (`PA-CLI-2`, severidad alta) · **ARREGLADO**
- Qué pasa: si muere `pa` y sobrevive su worker, otro `pa` puede ocupar el mismo worktree y cambiarle la rama mientras todavía trabaja. También borra el `.running` que permitía encontrar al worker anterior.
- Dónde: `app/electron/cli/pa/puestos.ts` línea 462 (`Admision.tomarPuesto`).
- Arreglo: después de tomar el candado del puesto y antes de aceptarlo, validar el `.running`; si su hijo sigue vivo, liberar ese puesto y tratarlo como ocupado. Agregar un test con padre muerto e hijo vivo que impida preparar el worktree.

**B079 · Dos repositorios con igual carpeta comparten worktree** (`PA-CLI-3`, severidad alta) · **ARREGLADO A MEDIAS**
- Qué pasa: dos proyectos distintos llamados, por ejemplo, `/clientes/a/demo` y `/clientes/b/demo` comparten estado, puestos y worktrees. Si tienen historia compatible, el segundo puede terminar escribiendo y commiteando en el repositorio del primero.
- Dónde: `app/electron/cli/pa/worktrees.ts` línea 538 (`asegurarWorktree`).
- Arreglo: antes de devolver `true` en la línea 538, comparar el Git común con el del proyecto y rechazar cualquier mezcla. Dar a cada ruta real una clave de estado y worktree inequívoca, conservando una resolución compatible del estado viejo. Probar dos clones con igual basename y nombres distintos del registry.

**B080 · Un rescate sin commit contamina la siguiente corrida** (`PA-CLI-4`, severidad alta) · **ARREGLADO**
- Qué pasa: si falla el commit de trabajo huérfano, se anuncia que quedó commiteado y se lanza otra corrida con esos cambios sin guardar. Sus archivos pueden quedar staged y entrar en el commit de una tarea distinta.
- Dónde: `app/electron/cli/pa/worktrees.ts` línea 519 (`commitearHuerfano`).
- Arreglo: comprobar `add`, `commit` y el estado final; si el rescate falla, abortar la preparación con código 87 y conservar la rama y sus cambios. Aplicar la misma guarda al rescate usado para integrar. Testear un hook que rechace el commit y exigir que no nazca otra rama de trabajo.

**B081 · Una corrida fallida puede habilitar la integración automática** (`PA-CLI-5`, severidad alta) · **ARREGLADO**
- Qué pasa: una corrida con código distinto de cero o `is_error=true` puede figurar como lista y quedar habilitada para integrarse sola. Esto ocurre si dejó commits, `DECISION: nada` y los tests del proyecto pasan, aunque el worker haya fallado después de guardar un resultado parcial.
- Dónde: `app/electron/cli/pa/hilos.ts` línea 463 (`armar`).
- Arreglo: leer el código durable de `.listo` o `.entregado`, exponerlo en la fila y distinguir el fallo antes de asignar `listo`/`decision`. Conservar compatibilidad con corridas viejas sin código. Un test debe impedir que una fila con `rc=1` sea candidata a integración automática aunque los demás campos sean favorables.

**B082 · Integrar no reconoce los puestos cortos de Windows** (`PA-CLI-6`, severidad media) · **ARREGLADO**
- Qué pasa: en una instalación normal de Windows, integrar o descartar una rama que quedó en su puesto de pa se niega diciendo que está fuera de los puestos. La falla no aparece si las pruebas fijan `PA_STATE` y usan la disposición larga.
- Dónde: `app/electron/cli/pa/ramas-base.ts` línea 123 (`puestoDeRuta`).
- Arreglo: hacer que los helpers de integración usen la misma disposición y comparación de rutas que los de lanzamiento, incluyendo el puesto reservado `integrar`. Agregar un test con la disposición predeterminada de Windows y otro con `PA_STATE` explícito.

**B083 · Un error recuperado del stream se vuelve un fallo final** (`PA-CLI-7`, severidad media) · **ARREGLADO**
- Qué pasa: aunque el proceso termine con 0 y el stream cierre con `turn.completed` y un resultado válido, un evento `error` anterior fuerza el fallo. Pa comunica que falló y entrega código 1.
- Dónde: `app/electron/cli/pa/motores/salida.ts` línea 136 (`codexAJson`).
- Arreglo: clasificar el desenlace del turno y conservar los errores previos como advertencias cuando exista una terminación exitosa posterior. Agregar casos de error recuperado seguido de éxito y error terminal sin `turn.completed`, conservando el fallo ante un rc distinto de cero.

**B084 · La cola aparece trabajando y sin tarea ni modelo** (`PA-CLI-8`, severidad media) · **ARREGLADO**
- Qué pasa: mientras espera cupo o puesto, el worker figura como trabajando pero sin tarea ni modelo. En Windows no hay un respaldo que recupere el pedido desde el proceso; el respaldo de Linux tampoco reconoce la entrada compilada `pa.js`.
- Dónde: `app/electron/cli/pa/async.ts` línea 584 (`lanzarAsync`).
- Arreglo: persistir tarea, modelo, cuenta y líder antes del fork y hacer que `--hilos` los lea también en cola. Mantener el estado de espera explícito y evitar depender de `/proc`. El test debe comprobar la fila completa antes de admitir el puesto, tanto para Linux como para Windows.

**B085 · Cobrar un éxito hace decir que no terminó bien** (`PA-CLI-9`, severidad media) · **ARREGLADO**
- Qué pasa: después de `pa --esperar`, una corrida que terminó bien deja de ser candidata a integración automática y el aviso explica «no terminó bien». El resultado y sus commits siguen intactos: lo único que cambió fue que el líder lo leyó.
- Dónde: `app/electron/cli/pa/hilos.ts` línea 453 (`armar`).
- Arreglo: conservar el desenlace independientemente de si el resultado ya fue entregado. Con un código de éxito durable, permitir evaluar una corrida entregada o informar un motivo de entrega que no afirme un fallo. Testear que cobrar el resultado no convierta un éxito en ese aviso.

**B086 · Al recuperar una sesión se conserva el id roto** (`PA-CLI-10`, severidad media) · **ARREGLADO**
- Qué pasa: cuando ya no existe la conversación retomada, pa logra crear otra, pero `--seguir --id <esta corrida>` vuelve a buscar el identificador viejo. Las continuaciones pierden otra vez la conversación que se acaba de recuperar.
- Dónde: `app/electron/cli/pa/lanzar.ts` línea 1075 (`lanzarClaude`).
- Arreglo: escribir atómicamente `<id>.sid` al cambiar `c.sid`, y mantenerlo alineado con cualquier `session_id` definitivo. Agregar un test de recuperación que luego retome esa misma corrida por su id.

**B087 · Async fija el límite antes de heredar el tipo** (`PA-CLI-11`, severidad media) · **ARREGLADO**
- Qué pasa: continuar o actualizar una corrida por async puede usar un límite de turnos distinto del correspondiente a su tipo. Una continuación de tipo `final` sin `--tipo` explícito queda en 50 turnos en lugar de 120; una mecánica puede recibir 50 en lugar de 30.
- Dónde: `app/electron/cli/pa/orquesta.ts` línea 318 (`orquestar`).
- Arreglo: transmitir además si el límite fue pedido explícitamente; cuando era un default, recalcularlo después de heredar el tipo en el hijo. Mantener `--max-turns 0` explícito como desactivación. Testear continuaciones async de `final`, `mecanico` y un límite explícito.

**B088 · El motor de ChatGPT no hace cumplir el límite de turnos** (`PA-CLI-12`, severidad media) · **ARREGLADO**
- Qué pasa: `--max-turns` se acepta para un worker de ChatGPT, pero no limita su ejecución. El límite por tipo tampoco lo corta; puede seguir usando herramientas y cupo después de superar lo pedido.
- Dónde: `app/electron/cli/pa/motores/llamada.ts` línea 152 (`armarLlamada`).
- Arreglo: contar y limitar los pasos del stream en este motor, con cierre de árbol y resultado `error_max_turns`, o rechazar el flag hasta tener un mecanismo efectivo. Un proceso ficticio que emita más pasos que el tope debe ser cortado; cero debe conservar la ejecución sin límite.

**B089 · Al volver el cupo se lanza el modelo agotado** (`PA-CLI-13`, severidad media) · **ARREGLADO**
- Qué pasa: una corrida en espera de cupo puede arrancar con el modelo anterior todavía agotado, aunque reparto ya haya ofrecido otro motor disponible. El mensaje afirma que TypeScript sólo corre Claude, pese a que los demás motores ya están implementados.
- Dónde: `app/electron/cli/pa/cupo.ts` línea 91 (`esperarCupo`).
- Arreglo: aplicar el candidato mediante el mismo cambio completo de modelo, motor y entorno que usa el relanzamiento por cupo; validarlo antes de salir de la espera y actualizar el motor que usa `orquestar`. Si no se puede usar, mantener la espera. Testear cambios en ambos sentidos entre Claude y otro motor.

**B090 · Vencer la espera de cupo pierde el resultado de cierre** (`PA-CLI-14`, severidad media) · **ARREGLADO**
- Qué pasa: cuando se agota el tiempo de espera de cupo, el hijo sale de forma controlada con 96, pero quien lo espera recibe 82 y el mensaje de que murió sin dejar resultado. Se pierde la causa durable del cierre y la fila queda como una muerte sin datos.
- Dónde: `app/electron/cli/pa/orquesta.ts` línea 373 (`orquestar`).
- Arreglo: instalar el cierre async antes de esperar cupo y guardar una marca `.listo` con rc 96 y el motivo incluso si nunca se admitió un puesto. Registrar también el fin sin inventar un inicio de ejecución del modelo. Testear que `--esperar` conserve 96 al vencer esa espera.

**B091 · El timeout de tests puede dejar la integración colgada** (`PA-CLI-15`, severidad media) · **ARREGLADO**
- Qué pasa: en Linux, un test que ignore SIGTERM deja `--integrar --tests` esperando indefinidamente aun después de vencer `PA_TESTS_MAX`. Conserva tomado el puesto de integración y bloquea su reutilización.
- Dónde: `app/electron/cli/pa/ramas.ts` línea 419 (`correrTests`).
- Arreglo: usar el helper común `correr` con `timeoutMs` y `killAfterMs`, o programar una escalada equivalente con limpieza de ambos timers. Probar un hijo que ignore TERM y exigir un cierre acotado con 124 y liberación del puesto. Mantener la terminación nativa de Windows.

### Puentes a otros motores

**B092 · ChatGPT (`codex.cmd`) falla antes de arrancar en Windows por comillas en `argsCodex`** (`PUENTES-1`, severidad alta) · **ARREGLADO**
- Qué pasa: Si en Windows `codex` está instalado vía npm (`codex.cmd`), cualquier turno de un líder de ChatGPT falla antes de lanzar el subproceso con el error `argumento no apto para cmd.exe: "model_reasoning_effort=\"medium\""`.
- Dónde: `app/electron/codex-stream.ts` líneas 249-252 (`argsCodex`) y `app/electron/codex-puente.ts` líneas 226-228 (`correrCodex`)
- Arreglo: En `codex-stream.ts:250,252`, quitar las comillas TOML innecesarias o resolverlas según bandera nativa (`--ask-for-approval never` en lugar de `-c approval_policy="never"` y verificar si `codex exec` acepta `model_reasoning_effort=medium` sin comillas —en TOML/CLI un enum simple suele pedirse con comillas, por lo que…

**B093 · El medidor de contexto de ChatGPT queda siempre en 0 tokens** (`PUENTES-2`, severidad alta) · **ARREGLADO**
- Qué pasa: El anillo/medidor de uso de contexto de un líder de ChatGPT marca `0` en vivo durante el turno y también al recargar el transcript desde disco, aunque `turn.completed` sí devuelva `input_tokens`.
- Dónde: `app/electron/codex-stream.ts` líneas 106-108, 139-147, 199-203 (`Traductor`) y `app/electron/codex-puente.ts` líneas 313, 319 (`turno`)
- Arreglo: 1. Pasar `contextoPrevio?: number | null` en `codex-stream.ts` (`Opciones` de `Traductor`) y enviarlo desde `codex-puente.ts:313` (`leerLado().contexto`). 2. Emitir un `message_start` / `assistant` sintético o actualizar el `usage` del último `assistant` / `message_start` cuando llega `turn.completed` (o que…

**B094 · «Mandar ya» nunca funciona en ChatGPT: falta `trama_directo`, eco perdido y errores en imagen sola** (`PUENTES-3`, severidad alta) · **ARREGLADO**: el puente y la marca en `lider.ts`.
- Qué pasa: Cuando el usuario manda un mensaje con «Mandar ya» a un líder de ChatGPT ocupado, el mensaje queda atrapado en la espera de gracia de `cola.ts` (4 s sin confirmación de eco) y en `p.directos` de `lider.ts` aunque sí haya entrado después al turno siguiente; si el «Mandar ya» llevaba sólo una imagen sin texto, `codex-puente.ts` anota `content: ""` en el transcript y nunca se confirma su entrega.
- Dónde: `app/electron/codex-puente.ts` líneas 181, 307, 417-418 (`mensajeDeUsuario`, `turno`, lector de stdin) en conjunto con `app/electron/lider.ts` línea 1426 (`mandarDirecto`)
- Arreglo: Agregar `|| p.clase === "codex"` en `app/electron/lider.ts:1426` y separar en `codex-puente.ts` una cola prioritaria `directos` (como en `agy-puente.ts`/`dsh-puente.ts`, si `codex exec` no se interrumpe a mitad de turno, al menos que salga antes que `cola` con su `eco`). Cubrir en `app/tests/lider-codex.test.ts`…

**B095 · Al parar a Gemini o caerse `agy` a mitad de turno, las herramientas quedan abiertas y el texto parcial se pierde** (`PUENTES-4`, severidad alta) · **ARREGLADO**
- Qué pasa: Si la persona toca «Parar» (`interrumpido = true`) o el proceso `agy` sale con error/código distinto de cero mientras hay una herramienta ejecutándose o texto parcial acumulado en un `agent_response` todavía en estado `RUNNING`, el turno termina emitiendo `result` sin cerrar la herramienta con `tool_result` ni volcar el texto acumulado. Al recargar la conversación desde el `.jsonl`, la herramienta queda girando…
- Dónde: `app/electron/agy-puente.ts` líneas 370-378 (`correrAgy`) y `app/electron/agy-stream.ts` líneas 287-301 (`Traductor.fin`)
- Arreglo: En `Traductor.fin(error)` (`app/electron/agy-stream.ts:287-301`), antes del `result`, volcar cualquier entrada pendiente en `this.texto` (emitir `content_block_stop`, `assistant` y `message_stop`) y anteponer `...this.cerrarAbiertas(error ?? "Interrumpido antes de que terminara este paso.")`. Cubrir en…

**B096 · Un «Mandar ya» en `dsh`/`opencode` tras reiniciarse la sesión manda el mensaje sin prefacio ni historial** (`PUENTES-5`, severidad alta) · **ARREGLADO**
- Qué pasa: Si un «Mandar ya» (`corte`) interrumpe un prompt de `dsh` u `opencode`, el proceso ACP muere (por el timeout `MS_CANCELAR` o por fallo del servidor al cancelar), y al relanzarlo `levantar()` no puede hacer `session/resume` y abre una sesión nueva, el mensaje directo se manda pelado, sin `PROMPT_DSH`/`PROMPT_OPENCODE`, sin los `CLAUDE.md`/`AGENTS.md`, sin el aviso de `pa` y sin el historial `hablado()`. Además…
- Dónde: `app/electron/dsh-puente.ts` líneas 748-754 (`turno`)
- Arreglo: En `dsh-puente.ts:751-752`, llamar `await asegurar()` siempre que `!cliente?.activo || !acpSid`, armar `const p = plegar(null, [])`, y si `faltaPrefacio` quedó en `true`, envolver `p.texto = conPrefacio(p.texto, hablado())` (o `previo`) y resetear `faltaPrefacio = false`. Agregar test en `app/tests/dsh-puente.test.ts`.

**B097 · Errores de cuota de OpenCode quedan colgados 3 minutos o sin detectar si llegan partidos, tras pensar o en `error.data`** (`PUENTES-6`, severidad alta) · **ARREGLADO**
- Qué pasa: Cuando OpenCode falla por límite gratis (`Free usage limit exceeded`) o `AI_RetryError`/`AI_APICallError` 429, el corte inmediato puede fallar y dejar al usuario esperando 180 s (`MS_SIN_EVENTOS`), o mostrar un error genérico sin marcar agotada la cuenta/modelo ni orientar al usuario.
- Dónde: `app/electron/dsh-puente.ts` líneas 565-572, 625-638 (`levantar`, `textoDeError`)
- Arreglo: Acumular el principio del texto del turno (sin cancelar la detección por chunks previos si aún no cerró herramienta/respuesta o acumulando los últimos N chars de `agent_message_chunk` iniciales cuando no hubo herramienta), evaluar `esErrorDeServidorOpencode(c.stderr)` sobre el buffer acumulado en `alStderr`, e…

**B098 · Cualquier error previo al primer paso borra la conversación guardada de Gemini/ChatGPT y reintenta desde cero** (`PUENTES-7`, severidad alta) · **ARREGLADO**
- Qué pasa: Si al retomar una conversación existente el primer turno falla antes de completar un paso (`v.pasos === 0`) por **cualquier** motivo —binario ausente (`ENOENT`), corte de red, sesión vencida/login caído, límite de cuota o modelo inválido— ambos puentes asumen que «no existía la conversación», tiran el ID real (`conversation_id` / `thread_id`), relanzan todo el proceso desde cero con un resumen de texto recortado a…
- Dónde: `app/electron/agy-puente.ts` líneas 370-374, 499-503 (`correrAgy`, `turno`) y `app/electron/codex-puente.ts` líneas 274-278, 317-321 (`correrCodex`, `turno`)
- Arreglo: No tratar `motivo !== null` (error de `spawn`) ni errores genéricos de red/auth/cuota como `v.sinConversacion`: inspeccionar `stderr` o el mensaje de `result`/`error` para disparar la recuperación con sesión nueva **solo** cuando el CLI indique que la conversación/hilo no existe o no se pudo cargar, propagando los…

**B099 · `politicaEnWorkspace` aprueba rutas fuera de la carpeta si vienen en `toolCall.rawInput`, `tool_call_update` o como `filepath`/`filePath`** (`PUENTES-8`, severidad media) · **ARREGLADO**
- Qué pasa: La política por defecto de `ClienteAcp` (`politicaEnWorkspace(raiz)`) deja pasar (`"permitir"`) pedidos de permiso que apuntan a archivos o directorios fuera de `raiz`, o que piden `danger-full-access`, en tres casos reales.
- Dónde: `app/electron/acp.ts` líneas 104-116, 314, 330 (`politicaEnWorkspace`, `ClienteAcp.notificacion`, `ClienteAcp.pedidoDelAgente`)
- Arreglo: En `acp.ts:314`, actualizar también `this.llamadas` ante `tool_call_update` que traiga `rawInput` (mezclando con el previo). En `acp.ts:330`, usar `this.llamadas.get(id) ?? (toolCall.rawInput && typeof toolCall.rawInput === "object" ? toolCall.rawInput : null)`. En `politicaEnWorkspace` (`113`), revisar también…

**B100 · Al desencolar mensajes entre turnos, ninguno de los tres puentes emite `status: "requesting"`** (`PUENTES-9`, severidad media) · **ARREGLADO**
- Qué pasa: Cuando un mensaje estaba esperando en la cola interna del puente (o quedó un «Mandar ya» sin entrar en `directos` al cerrarse el turno anterior), el puente termina el turno con `result`, `lider.ts` pone al líder como libre (`x.ocupado = false`), e inmediatamente el puente arranca el turno siguiente en `cerrarTurno()`, pero la interfaz y `lider.ts` creen que el líder está en reposo (`ocupado: false`) hasta que el…
- Dónde: `app/electron/agy-puente.ts` líneas 539-549, `app/electron/dsh-puente.ts` líneas 788-797, `app/electron/codex-puente.ts` líneas 343-349 (`cerrarTurno`, junto con `app/electron/lider.ts` líneas 747-749, 780-784)
- Arreglo: Emitir `{ type: "system", subtype: "status", status: "requesting", parent_tool_use_id: null, session_id: sid }` al desencolar un mensaje en `cerrarTurno()` (o al entrar a `turno()`) en `agy-puente.ts`, `dsh-puente.ts` y `codex-puente.ts`. Cubrir con test en `app/tests/lider-gemini.test.ts` / `dsh-puente.test.ts` /…

**B101 · Al retomar en `dsh`/`opencode`, se mantiene el modelo viejo si `configOptions` omite `model` o `currentValue`** (`PUENTES-10`, severidad media) · **ARREGLADO**
- Qué pasa: Si el usuario cambia de modelo (o se relanza el puente con otro modelo sobre una sesión existente) y el agente ACP devuelve `configOptions: []` o una opción `model` sin `currentValue` (`undefined`) en `session/resume` o `session/new`, `dsh-puente` se saltea `session/set_config_option` y sigue ejecutando el modelo anterior en silencio, mientras la app etiqueta los mensajes con el modelo nuevo.
- Dónde: `app/electron/dsh-puente.ts` líneas 598-600 (`levantar`)
- Arreglo: Cuando `oc` está activo (donde el CLI se lanza siempre con `["acp"]` sin flag de modelo) o cuando `!nueva` (`session/resume`), si `actualOpt !== quiero`, intentar `c.configurar(acpSid, "model", quiero)` incluso si `actualOpt === undefined` (capturando sólo si el agente declara explícitamente no soportar la opción…

**B102 · Chunks ACP sin `messageId` crean un globo separado por cada pedazo de texto o pensamiento** (`PUENTES-11`, severidad media) · **ARREGLADO**
- Qué pasa: Si un agente ACP emite `agent_message_chunk` o `agent_thought_chunk` sin campo `messageId` (que en ACP es opcional cuando un agente streamea token a token), cada chunk genera un mensaje `assistant` completo por separado y una burbuja nueva en el chat.
- Dónde: `app/electron/dsh-puente.ts` líneas 280-289 (`Traductor.trozo`)
- Arreglo: Si `u.messageId` viene vacío (`null`), reutilizar `this.buf.id` cuando ya haya un buffer abierto del mismo mensaje (en vez de incrementar `this.n` en cada chunk) y recién asignar `m${++this.n}` cuando `this.buf` sea `null`, cerrando al llegar un `messageId` distinto, una herramienta o el fin de turno. Agregar test en…

**B103 · Desfase al parar (`PARAR_MS` 3 s vs `MS_CANCELAR` 10 s): `SIGINT` reinicia el corte en Linux y `taskkill` mata el puente en Windows** (`PUENTES-12`, severidad media) · **ARREGLADO A MEDIAS**: hecho en Linux; en Windows el líder todavía mata el árbol a los 3 s.
- Qué pasa: Al apretar «Parar» en un turno que tarda en cancelarse (> 3 s): - En Windows, `lider.ts` mata a los 3 s (`PARAR_MS = 3000`) el proceso entero del puente (`dsh-puente`, `agy-puente` o `codex-puente`) con `taskkill /T /F`, sin darle tiempo a `dsh-puente` (que espera hasta 10 s con `MS_CANCELAR = 10000` antes de matar a `dsh`/`opencode`), sin emitir `result` ni cerrar herramientas abiertas en el transcript y dejando…
- Dónde: `app/electron/dsh-puente.ts` líneas 674-681, 809-811, `app/electron/agy-puente.ts` líneas 552-558, 614-616 y `app/electron/codex-puente.ts` líneas 351-357, 372-374 (frente a `app/electron/lider.ts` líneas 123,…
- Arreglo: Alinear los tiempos (`PARAR_MS` en `lider.ts` por clase o mayor al timeout interno del puente cuando el subproceso existe, o bajar `MS_CANCELAR` por debajo de `PARAR_MS` para que el puente mate primero al hijo y cierre el turno con `result`), y en el handler de `SIGINT` de los tres puentes escalar directamente al…

**B104 · `destrabar()` omite el lector de razonamiento (`pensamiento`) en los reintentos de Gemini** (`PUENTES-13`, severidad media) · **ARREGLADO**
- Qué pasa: Cuando el vigilante detecta un bucle en Gemini y `destrabar()` lanza una vuelta nueva de `agy` con el aviso para destrabarlo, todos los bloques de razonamiento (`thinking` / `pensado`) de esa vuelta y de las siguientes del bucle dejan de aparecer tanto en la vista como en el transcript.
- Dónde: `app/electron/agy-puente.ts` línea 589 (`destrabar`)
- Arreglo: Agregar `pensamiento: razonamiento` en la llamada de la línea 589 de `app/electron/agy-puente.ts`. Cubrir con un test en `app/tests/agy-directo.test.ts`.

**B105 · `resumen-traspaso.ts` ignora ramas descartadas por `parentUuid` y toma errores sintéticos de API como estado actual** (`PUENTES-14`, severidad media) · **ARREGLADO**
- Qué pasa: Al usar «Seguir con otro modelo» sobre un transcript que tuvo rebobinados/ramas (con `parentUuid` apuntando a un ancestro anterior) o cuyo último turno terminó con un error sintético de API (por ejemplo `API Error: 529 Overloaded`): 1. El resumen incluye archivos editados, commits y decisiones de la rama vieja que la persona ya había descartado al volver atrás. 2. El texto del error sintético pisa `d.estado`…
- Dónde: `app/electron/resumen-traspaso.ts` líneas 75-112, 120-134, 150 (`extraerDatos`, `secciones`)
- Arreglo: Si las líneas tienen `uuid`/`parentUuid`, reconstruir la ruta desde la última entrada no sidechain hacia la raíz antes de extraer datos (dejando el recorrido lineal como respaldo cuando falten `uuid`); saltear registros con `isApiErrorMessage === true` o `message?.model === "<synthetic>"`; y mantener el orden…

**B106 · En `codex-puente.ts`, mensajes con sólo imágenes quedan vacíos en el transcript, rompen `hablado()` y silencian fallos al guardar** (`PUENTES-15`, severidad media) · **ARREGLADO**
- Qué pasa: Cuando la persona envía un mensaje a ChatGPT compuesto sólo por imágenes (sin texto), o cuando falla la escritura de las imágenes en `DIR_IMAGENES`: 1. La línea 312 anota en el transcript `{ type: "user", message: { role: "user", content: m.texto } }` sin dejar constancia de las imágenes (a diferencia de `agy-puente.ts:261,487` y `dsh-puente.ts:729`). En un reinicio o recarga, el turno del usuario desaparece por…
- Dónde: `app/electron/codex-puente.ts` líneas 128-134, 151, 201-215, 312 (`guardarLado`, `hablado`, `guardarImagenes`, `turno`)
- Arreglo: Incluir la nota `[N imagen(es) adjunta(s)]` en el `anotar` de la línea 312 cuando `imagenes.length > 0` (y avisar en el prompt / error si `guardarImagenes` falla al escribir en disco, retornando también si `rutas.length < m.imagenes.length`), y hacer atómico `guardarLado` con `.tmp` + `renameSync` (con respaldo…

**B107 · `describirError` oculta `error.data` y `stderr` en errores ACP que no tienen código `-32603`** (`PUENTES-16`, severidad baja) · **ARREGLADO**
- Qué pasa: Cuando un agente ACP (`dsh` u `opencode`) responde un error JSON-RPC con código distinto de `-32603` (por ejemplo `-32000 "Server error"` o cualquier código de proveedor cuyo texto útil viene en `error.data` o en `stderr`), `describirError` ignora por completo `e.data` y `stderr` y devuelve sólo `"session/prompt: Server error"`, privando a la persona de la causa real.
- Dónde: `app/electron/acp.ts` líneas 61-78 (`describirError`)
- Arreglo: Anexar `e.data` para cualquier `ErrorAcp` cuando no esté vacío y sea distinto de `base`, y anexar la cola de `stderr` cuando `e instanceof ErrorAcp` (o cuando un error genérico traiga `stderr` no reflejado en `base`). Cubrir en `app/tests/acp.test.ts`.

**B108 · Cierre brusco en `dsh-puente.ts` (no usa `cliente.cerrar()`) y `taskkill` asíncrono incompleto al salir en Windows** (`PUENTES-17`, severidad baja) · **PENDIENTE**: falta en Windows: el `taskkill` al salir es asíncrono.
- Qué pasa: 1. `dsh-puente.ts` nunca llama al método `cliente.cerrar()` que existe en `acp.ts:227-239`: al cerrarse `stdin` en reposo (`860`), llama directamente a `terminar(0)` que dispara `cliente?.matar()` (`SIGKILL` / `taskkill /F`) inmediatamente en lugar de cerrar `stdin` de `dsh`/`opencode` y esperar su salida limpia (arriesgando dejar sesiones sin volcar a disco). 2. En Windows, `matarArbol()`…
- Dónde: `app/electron/dsh-puente.ts` líneas 799-803, 813-817 (`terminar`, `exit`), `app/electron/agy-puente.ts` líneas 618-623 y `app/electron/codex-puente.ts` líneas 376-380
- Arreglo: Volver asíncrono el cierre limpio en `dsh-puente.ts` (`await cliente?.cerrar()` cuando cierra `stdin` en reposo o en `SIGTERM`/`SIGINT` antes de `process.exit()`), y para el respaldo de `exit` en Windows evaluar `execFileSync("taskkill", ...)` acotado (o job object / `matar` previo a `process.exit`) en `procesos.ts`…

**B109 · `comandosDeAgy()` bloquea el loop con `spawnSync` hasta 3 s y cachea `[]` de por vida tras un fallo único** (`PUENTES-18`, severidad baja) · **ARREGLADO**
- Qué pasa: Al responder el `initialize` inicial del puente, `comandosDeAgy()` corre `spawnSync` con timeout de 3000 ms (congelando el loop de stdin/stdout del puente mientras corre `agy plugin list --json`). Si por cualquier motivo temporal falla, sale con código distinto de 0 o vence el timeout una sola vez, guarda `comandosCache = []`. Como el chequeo siguiente es `if (comandosCache)` (`[]` es truthy en JavaScript), la…
- Dónde: `app/electron/agy-puente.ts` líneas 633-646 (`comandosDeAgy`)
- Arreglo: No asignar `comandosCache = []` en el bloque `catch` (devolver `[]` sin cachear el error, o cachear sólo cuando `r.status === 0` y no hubo error), y opcionalmente volverlo asíncrono con `execFile` en el manejador de `initialize`. Cubrir en `app/tests/agy-directo.test.ts`.

**B110 · `contexto-local.ts` oculta `AGENTS.md` si `CLAUDE.md` se recorta después de mencionarlo y limita a 4000 tokens un proyecto fuera de `~`** (`PUENTES-19`, severidad baja) · **ARREGLADO**
- Qué pasa: 1. Cuando un `CLAUDE.md` excede el tope de tokens y `poner()` lo recorta, `agentsAparte` recibe el texto **sin recortar** (`claude = sinSecciones(await conImports(...), fuera)`). Si el contenido de `AGENTS.md` (o `@AGENTS.md`) venía después del punto de recorte, `!claude.includes(agents.trim())` da `false` y `AGENTS.md` no se agrega por separado aunque haya quedado mutilado. 2. Cuando `cwd` está fuera de `home`…
- Dónde: `app/electron/contexto-local.ts` líneas 163-164, 175-186 (`armarContexto`)
- Arreglo: Devolver desde `poner()` el texto efectivamente incluido (ya recortado) y pasárselo a `agentsAparte`, y sólo asignar `primero` como archivo de `~` cuando `path.dirname(textos[0][0]) === home` (dejando los demás en `proyecto`). Agregar test en `app/tests/contexto-local.test.ts`.

**B111 · `ClienteAcp.iniciar()` deja el proceso vivo si falla `initialize` y `this.llamadas` retiene cada `rawInput` sin limpiarse** (`PUENTES-20`, severidad baja) · **ARREGLADO**
- Qué pasa: 1. En `iniciar()`, `this.hijo = p; this.vivo = true;` quedan asignados antes de `await this.pedir("initialize", ...)`. Si `initialize` rechaza (error JSON-RPC) o vence el timeout de 60 s sin que el hijo cierre, `iniciar()` lanza pero deja al subproceso vivo en segundo plano y al objeto `ClienteAcp` inutilizable (`if (this.hijo) throw new Error("acp: el agente ya está lanzado")`). `dsh-puente.ts` lo mitiga llamando…
- Dónde: `app/electron/acp.ts` líneas 124, 157-194, 314 (`ClienteAcp.iniciar`, `notificacion`)
- Arreglo: Envolver `await this.pedir("initialize", ...)` en `try/catch` dentro de `iniciar()` llamando a `this.matar()` y limpiando `this.hijo = null; this.vivo = false;` si falla; y en `notificacion()`, borrar `this.llamadas.delete(u.toolCallId)` cuando llegue `tool_call_update` con estado terminal (`completed`/`failed`), o…

### Reparto y cupos

**B112 · Revive un modelo excluido y sin cupo** (`REPARTO-CUPOS-1`, severidad alta) · **ARREGLADO**
- Qué pasa: un modelo gratis apagado en Ajustes y con el grupo agotado puede salir elegido como si tuviera cupo. También se salta el piso duro del perfil agresivo cuando sólo quedan estas ofertas.
- Dónde: `app/electron/cli/reparto.ts` línea 3141 (`elegir`)
- Arreglo: en las líneas 3063–3080 comprobar exclusiones, indisponibilidad y límites antes de decidir si se puede relajar calidad; al revivir, conservar todos los vetos independientes. En la línea 3143 no relajar `duro_calidad` para agresivo. Cubrir con un caso de único gratis de calidad baja excluido, otro agotado y otro con…

**B113 · Pierde el cierre si falla la escritura** (`REPARTO-CUPOS-2`, severidad alta) · **ARREGLADO**
- Qué pasa: tras un error al escribir la señal, el cierre queda sólo en memoria y sus avisos pueden perderse. Aunque el disco se recupere, una lectura igual no vuelve a escribir ni a notificar ese cierre.
- Dónde: `app/electron/cierre-cupo-disco.ts` línea 37 (`crearCierreCupo.revisar`)
- Arreglo: conservar un paso pendiente hasta confirmar su escritura y entregar sus eventos una sola vez; reintentarlo aunque la siguiente lectura no cambie. Cubrir tanto un fallo al escribir como uno al borrar la señal.

**B114 · ChatGPT no llega al vigilante de cierre** (`REPARTO-CUPOS-3`, severidad alta) · **ARREGLADO**
- Qué pasa: la cabecera puede mostrar ChatGPT al 99 %, pero ese dato no dispara su cierre ordenado. La cuenta de siempre tampoco coincide con las señales que esperan el nombre `chatgpt`.
- Dónde: `app/electron/cli/reparto.ts` línea 1921 (`cuposOpenai`)
- Arreglo: conservar `id:"openai"` si lo necesitan los consumidores existentes, pero agregar `proveedor:"chatgpt", cuenta:"chatgpt"` en la línea 1921. Verificar el recorrido real reparto → parser → vigilante, y que una señal de ChatGPT descarte sus candidatos.

**B115 · Ofrece Claude aunque no esté disponible** (`REPARTO-CUPOS-4`, severidad alta) · **ARREGLADO**
- Qué pasa: sin proveedores disponibles, el reparto dice que puede correr un Claude. En una máquina con una sola suscripción de otro proveedor, también puede ofrecer ese Claude inexistente cuando la alternativa se queda sin cupo.
- Dónde: `app/electron/cli/reparto.ts` línea 2753 (`armarCandidatos`)
- Arreglo: quitar la condición `ofertasDsh.length` de la línea 2753 y filtrar Claude por disponibilidad de su cuenta antes de armar candidatos; no confundir falta de porcentajes con falta de conexión. Probar cero proveedores, sólo Google y sólo ChatGPT, con y sin cupo.

**B116 · El reparto fijo ignora modelos apagados** (`REPARTO-CUPOS-5`, severidad alta) · **ARREGLADO**
- Qué pasa: un modelo asignado a un tipo sigue siendo la elección fija después de apagarlo en Ajustes. El veto de la persona no se aplica a esa selección.
- Dónde: `app/electron/cli/reparto.ts` línea 3117 (`elegir`)
- Arreglo: antes del retorno fijo, verificar la asignación contra las exclusiones; aplicar también ese veto a las elecciones fijas de `pa`, con la excepción explícita de `--ok-dueno`. Probar asignar, apagar y lanzar sin `-m`.

**B117 · No deja guardar elecciones de ChatGPT** (`REPARTO-CUPOS-6`, severidad media) · **ARREGLADO**
- Qué pasa: una elección `codex:*` de líder o worker no se puede guardar en `modelos.json`. Si ya viene del archivo, guardar otro ajuste que reenvía esa configuración también falla.
- Dónde: `app/electron/modelos-tipos.ts` línea 375 (`validarEleccion`)
- Arreglo: agregar un reconocedor y una validación de ids Codex a la línea 375, manteniendo el esfuerzo en el id. Cubrir lectura → guardado sin cambios y cambio de perfil con líder y worker Codex.

**B118 · Los modelos descubiertos de agy saltean los esfuerzos permitidos** (`REPARTO-CUPOS-7`, severidad media) · **ARREGLADO**
- Qué pasa: un modelo de agy que no está en la tabla incorporada puede ser elegido aunque la persona le haya dejado la lista de esfuerzos vacía.
- Dónde: `app/electron/cli/reparto.ts` línea 2830 (`armarCandidatos.hacer`)
- Arreglo: en la rama de la línea 2830 consultar `effortsDe` aunque el id no admita un esfuerzo separado; la lista vacía siempre debe descartarlo. Para ids con sufijo, verificar su esfuerzo real. Cubrir ambos formatos de catálogo.

**B119 · Una semana agotada se anuncia con el reinicio corto** (`REPARTO-CUPOS-8`, severidad media) · **ARREGLADO**
- Qué pasa: al marcar un grupo de Google sin cupo semanal, se anuncia que vuelve al reiniciarse la ventana de 5 h. Mientras rige la marca, también se reemplaza por esa hora el reinicio semanal que se había leído correctamente.
- Dónde: `app/electron/cli/reparto.ts` línea 2235 (`agotar`)
- Arreglo: en la línea 2235 determinar las ventanas que bloquean y usar la más tardía de sus fechas; conservar las ventanas originales al aplicar una marca y separar la hora del bloqueo de los reinicios medidos. Probar semana llena con ventana corta libre y ambas llenas.

**B120 · Conserva como llena una ventana de Google que ya terminó** (`REPARTO-CUPOS-9`, severidad media) · **ARREGLADO**
- Qué pasa: después del reinicio de Google, el reparto sigue descartando el modelo por el porcentaje anterior hasta que vence la caché. La lectura de fondo puede mantenerlo así hasta diez minutos.
- Dónde: `app/electron/cli/reparto.ts` línea 1488 (`cuposGoogle`)
- Arreglo: invalidar la caché al cruzar un reinicio conocido y no usar como actual el porcentaje de un bucket vencido. Si no se puede refrescar, informarlo como sin dato. Probar avanzar el reloj a ambos lados del reinicio con la misma caché.

**B121 · Codex elige el dato por archivo y no por fecha del evento** (`REPARTO-CUPOS-10`, severidad media) · **ARREGLADO**
- Qué pasa: el porcentaje de ChatGPT puede bajar a una lectura vieja aunque otro transcript tenga una medición más nueva y mucho más alta. También puede reaparecer un porcentaje alto anterior.
- Dónde: `app/electron/cli/reparto.ts` línea 1904 (`rateLimitsCodex`)
- Arreglo: juntar las mediciones válidas de los archivos examinados y elegir la más reciente por timestamp para cada ventana; usar `mtime` sólo como respaldo cuando no haya timestamp. Probar el transcript viejo que recibe una escritura sin medición.

**B122 · Olvida las ausencias al calcular la semana en curso** (`REPARTO-CUPOS-11`, severidad media) · **ARREGLADO**
- Qué pasa: al llegar la medianoche se olvida un día que se había marcado como no trabajado, aunque todavía pertenezca a la ventana semanal actual. El reparto cambia de ritmo como si ese día se hubiera trabajado.
- Dónde: `app/electron/cli/reparto.ts` línea 2393 (`planLeer`)
- Arreglo: en la línea 2393 conservar por lo menos las ausencias de los últimos siete días, además de las futuras; eliminarlas sólo cuando ya no puedan pertenecer a una ventana vigente. Probar el mismo plan antes y después de medianoche y su avance durante la semana.

**B123 · Dos guardados usan el mismo temporal** (`REPARTO-CUPOS-12`, severidad media) · **ARREGLADO A MEDIAS**
- Qué pasa: dos cambios simultáneos de modelos pueden hacer fallar un guardado con `ENOENT`; el contenido de uno puede reemplazar al otro. No hay una cola compartida entre el riel y las distintas ventanas de Ajustes.
- Dónde: `app/electron/modelos-config.ts` línea 153 (`guardarModelos`)
- Arreglo: serializar todo leer → unir → escribir por ruta real y generar temporales únicos, limpiándolos al fallar. Definir el orden de aplicación de cambios independientes para no pisarlos con un borrador anterior. Probar guardados concurrentes del perfil y de otra preferencia.

**B124 · Cuentas rechaza un listado de agy que el reparto acepta** (`REPARTO-CUPOS-13`, severidad media) · **ARREGLADO**
- Qué pasa: Ajustes puede mostrar Google sin conectar aunque `agy models` haya devuelto modelos válidos. El reparto y la tarjeta de cuenta discrepan usando la misma salida.
- Dónde: `app/electron/cuentas.ts` línea 44 (`esModelo`, usado por `sondearAgy`)
- Arreglo: compartir un parser puro para ambos caminos, con los tres formatos admitidos, sin importar todo el reparto desde Cuentas. Probar id solo, id con tabulación, nombre legible y mensajes sin modelos.

**B125 · Descarta el único porcentaje conocido de Claude** (`REPARTO-CUPOS-14`, severidad media) · **ARREGLADO**
- Qué pasa: cuando sólo se conoce una ventana de Claude, se pierde también ese dato válido. Sin otra fuente de uso, la cabecera y el vigilante no ven ni siquiera una semana al 99 %.
- Dónde: `app/electron/cupos.ts` línea 146 (`parsearCuposReparto`)
- Arreglo: permitir porcentajes ausentes por ventana en `CuposLeidos.claude` y construir cada ventana de `lecturaCupos` por separado. Mantener los valores desconocidos como `null`, sin inventar 0 %. Cubrir ambos casos de una sola ventana conocida.

**B126 · La cabecera vence los grupos con el día UTC** (`REPARTO-CUPOS-15`, severidad baja) · **ARREGLADO**
- Qué pasa: en Argentina, un grupo válido hasta el día indicado desaparece de los cupos a las 21:00 de ese día. En zonas al este de UTC puede durar más de lo que corresponde en la vista.
- Dónde: `app/electron/cupos.ts` línea 103 (`vencido`)
- Arreglo: en la línea 103 comparar con la fecha local, usando el mismo criterio que `hastaFin`. Probar la hora anterior a medianoche local en UTC−3 y UTC+9.

### Sistema: instalación, actualización y servicio

**B127 · Guardar una clave en Ajustes borra `TRAMA_REPORTES_CLAVE` (y comentarios y otras líneas)** (`SISTEMA-1`, severidad alta) · **ARREGLADO**
- Qué pasa: Cuando el dueño guarda o borra cualquier clave en Ajustes (OpenCode, DeepSeek, NVIDIA, un valor de MCP), el archivo se reescribe sin su `TRAMA_REPORTES_CLAVE`. Los reportes anónimos dejan de bajarse, sin aviso ni log.
- Dónde: `app/electron/claves.ts` línea 94-104 (`escribir`); lo consume `app/electron/reporte-anonimo.ts` línea 59 (`claveLectura`)
- Arreglo: En `escribir`, leer el texto actual y conservar tal cual toda línea que no sea de `NOMBRES_CLAVE` ni `MCP_*` (comentarios incluidos). Reemplazar o agregar sólo las líneas propias. Test: un archivo con `TRAMA_REPORTES_CLAVE` y un comentario sobrevive a guardar y a borrar claves.

**B128 · Un error al leer `programados.json` se toma por «vacío» y el siguiente guardado pisa todo** (`SISTEMA-2`, severidad media) · **ARREGLADO**
- Qué pasa: Si la lectura falla por algo que no es «no existe» (permisos, archivo trabado, falta de descriptores), la lista arranca vacía. La próxima vez que se programe o posponga algo se escribe el archivo vacío y se pierden todos los mensajes programados.
- Dónde: `app/electron/nucleo.ts` línea 588 (`leer`); `app/electron/programados.ts` líneas 75-79 y 115-123 (`leerFoto`, `guardar`)
- Arreglo: Que `leer` devuelva `null` sólo si el error es ENOENT. Ante otro error, `cargar` debe guardar el fallo y bloquear `guardar` (o renombrar el archivo a `.roto` antes de pisarlo). Test en `tests/programados.test.ts`: `leer` rechaza con EACCES y `escribir` no se llama.

**B129 · «Mandar a la papelera» no mira si hay líderes o workers vivos cuando el proyecto ya estaba quitado** (`SISTEMA-3`, severidad media) · **ARREGLADO**
- Qué pasa: Si el proyecto ya figura «retirado», se manda su carpeta a la papelera aunque haya un líder con proceso o un worker vivo trabajando adentro. Para un proyecto no retirado sí se niega.
- Dónde: `app/electron/proyectos-borrar.ts` línea 234-238 (`papeleraProyecto`)
- Arreglo: Llamar `negarSiVivos(p, deps)` siempre, antes de `papelera`. Test en `tests/proyectos-borrar.test.ts`: retirado + vivo → rechaza.

**B130 · En Windows la «papelera» puede borrar para siempre si la carpeta no entra en la Papelera de Reciclaje** (`SISTEMA-4`, severidad media) · **PENDIENTE**
- Qué pasa: `DeleteDirectory(..., 'OnlyErrorDialogs', 'SendToRecycleBin')` se usa para no mostrar diálogos. Si Windows no puede meter la carpeta en la papelera (tamaño, unidad de red), puede borrarla de forma permanente sin preguntar. Eso rompe la regla «nunca borra de forma definitiva».
- Dónde: `app/electron/proyectos-borrar.ts` línea 135 (`papeleraReal`)
- Arreglo: Usar `UIOption.AllDialogs` (que obliga a confirmar) o chequear tamaño y unidad antes. Más seguro: mover con `Shell.Application`/`SHFileOperation` con `FOF_ALLOWUNDO` sin `FOF_NOCONFIRMATION` y tratar «cancelado» como `fallo`. Test: sólo de forma, porque el comando es de Windows.

**B131 · Una advertencia de `git` en stderr hace que Actualizar crea que el checkout está «sucio» y se niegue** (`SISTEMA-5`, severidad media) · **ARREGLADO**
- Qué pasa: Actualizar queda bloqueada con «hay cambios sin commitear» aunque el árbol esté limpio.
- Dónde: `app/electron/actualizacion-trama.ts` líneas 111-115 (`correrReal`) y 341-344 (`sucioEn`)
- Arreglo: Que `Corrida` traiga `stdout` aparte y `sucioEn` use sólo `stdout`. Test en `tests/actualizacion-trama.test.ts`.

**B132 · Prender o apagar un conector rompe el enlace simbólico de `~/.claude/settings.json`** (`SISTEMA-6`, severidad media) · **ARREGLADO**
- Qué pasa: Si el settings (o `settings.local.json`) es un enlace a un dotfile, Trama lo reemplaza por un archivo normal. La copia versionada queda desactualizada.
- Dónde: `app/electron/conectores-claude.ts` líneas 453-461 (`cambiarAjustes`)
- Arreglo: `const real = await realpath(ruta).catch(() => ruta)` y escribir/renombrar sobre `real`. Test en `tests/conectores-claude.test.ts` con un enlace.

**B133 · Si falla una descarga a mitad, los reportes ya bajados (y borrados del receptor) no se avisan** (`SISTEMA-7`, severidad media) · **ARREGLADO**
- Qué pasa: Con 3 reportes, si el primero se escribe y se borra del receptor y el segundo da error de red, de disco o timeout, la función lanza. Nunca llega a `avisar` y el dueño no se entera del primero.
- Dónde: `app/electron/reporte-anonimo.ts` líneas 118-136 (`bajarReportes`)
- Arreglo: `try/catch` por id (seguir con el siguiente) o llamar `avisar` apenas se escribe cada uno. Test en `tests/reporte-anonimo.test.ts`.

**B134 · La limpieza de texto de reportes deja pasar los caracteres «tag» invisibles (inyección a modelos)** (`SISTEMA-8`, severidad media) · **ARREGLADO**
- Qué pasa: `limpiarTexto` promete quitar «invisibles», pero un reporte con caracteres U+E0000–E007F (tag characters) conserva texto oculto. Ese texto no se ve al leerlo, pero un modelo lo lee. Es un vector conocido de inyección de instrucciones, justo contra lo que `docs/reglas/reportes.md` dice proteger.
- Dónde: `app/electron/reportes-reglas.ts` línea 15 (`CONTROL`) y 18-21 (`limpiarTexto`)
- Arreglo: Usar `/[...]/gu` con `\u{E0000}-\u{E007F}`, `\u{E0100}-\u{E01EF}`, `\u00AD`, `\u034F`, `\u061C`, `\u180E`, `\uFE00-\uFE0F`, `\u2028-\u2029`. Aplicarlo en el Worker y en la Trama (comparten el archivo). Test en `tests/reporte-anonimo.test.ts`.

**B135 · `limpiarLog` no tapa claves en JSON ni en cabeceras con guion (`"token":"…"`, `x-api-key:`)** (`SISTEMA-9`, severidad media) · **ARREGLADO**
- Qué pasa: El reporte (público en GitHub, o anónimo) puede llevar valores secretos si el log los trae como `"access_token":"abc..."`, `"apiKey": "..."` o `x-api-key: abc`.
- Dónde: `app/electron/reporte.ts` línea 40 (patrón de `CLAVES`), usada en `limpiarLog` línea 50
- Arreglo: Permitir comillas opcionales tras el nombre, `[-_]?` entre `API` y `KEY`, y sumar un patrón `://[^/\s:@]+:[^/\s@]+@`. Test en `tests/reporte.test.ts`.

**B136 · Los errores de escritura de `programados.json` se tragan y el mensaje puede salir dos veces** (`SISTEMA-10`, severidad baja) · **ARREGLADO**
- Qué pasa: Con el disco lleno o sin permiso, `programar` dice «listo» pero no queda guardado. En `vencer`, el mensaje sale, pero el archivo conserva su copia y sale de nuevo al reiniciar Trama.
- Dónde: `app/electron/programados.ts` líneas 115-119 (`guardar`) y 160-166 (`vencer`)
- Arreglo: Que `guardar` propague el error (o lo registre con `silencio`) y que `programar` falle si no se pudo escribir.

**B137 · «2026-11-05 25:00» o «09:99» se aceptan como fechas válidas** (`SISTEMA-11`, severidad baja) · **ARREGLADO**
- Qué pasa: Escribir una hora fuera de rango en la fecha completa programa el mensaje para otra hora (25:00 → 01:00 del día siguiente) sin avisar.
- Dónde: `app/electron/programados-hora.ts` líneas 54-58 (`resolverCuando`)
- Arreglo: Rechazar `Number(f[4]) > 23` o `Number(f[5]) > 59` y comparar también el día. Test en `tests/programados-hora.test.ts`.

**B138 · Si Actualizar vence por tiempo, el instalador sigue vivo y se puede lanzar otro encima** (`SISTEMA-12`, severidad baja) · **ARREGLADO**
- Qué pasa: A los 30 minutos se mata sólo `bash`; sus hijos (`npm`, compilación) siguen. La ventana muestra error, la persona vuelve a apretar Actualizar y corren dos instaladores juntos.
- Dónde: `app/electron/actualizacion-trama.ts` línea 129 (`correrSuelto`)
- Arreglo: Linux: `process.kill(-hijo.pid, "SIGTERM")`. Windows: `taskkill /T /F` con `windowsHide`.

**B139 · Descubrir: si una fuente falla y la otra anda, la fallida no se reintenta por 24 horas, y el registro MCP queda cortado** (`SISTEMA-13`, severidad baja) · **ARREGLADO A MEDIAS**
- Qué pasa: Si GitHub falla pero el registro MCP contesta, `actualizado` se pone en `ahora`, y la caché se considera vigente un día. Abrir la sección no vuelve a intentar GitHub, y quedan skills viejas o ninguna. Aparte, `bajarMcp` pide como mucho 6 páginas de 100, sin avisar que el catálogo está incompleto (el registro tiene bastante más).
- Dónde: `app/electron/descubrir.ts` líneas 516-522 (`catalogo`) y 324-332 (`bajarMcp`)
- Arreglo: Considerar vigente sólo si los dos `errores` son `null`, o reintentar la fuente con error. Guardar `truncado: true` y mostrarlo en la interfaz (texto es/en).

**B140 · `instalar.sh` no escapa la ruta del checkout (`'`, `&`, espacios en el `.desktop`)** (`SISTEMA-14`, severidad baja) · **ARREGLADO**
- Qué pasa: Con un checkout en una ruta con `'`, el lanzador `trama` queda con sintaxis rota. Con `&` o `|`, la unidad `trama-motor.service` lleva una ruta mal armada. Con espacios en `$HOME`, el `Exec=` del menú no abre.
- Dónde: `app/scripts/instalar.sh` línea 57 (`raiz='$raiz'`), 94 (`Exec=$bin`) y 119 (`sed "s|@RAIZ@|…|g"`)
- Arreglo: Escapar con `printf %q` para el lanzador, y con `${raiz//\\/\\\\}` / `${raiz//&/\\&}` / `${raiz//|/\\|}` para `sed` (o usar `awk`). Entrecomillar `Exec="$bin"`.

**B141 · `wayland.ts` ignora un `WAYLAND_DISPLAY` absoluto que el lanzador de `instalar.sh` sí respeta** (`SISTEMA-15`, severidad baja) · **ARREGLADO**
- Qué pasa: Con `WAYLAND_DISPLAY=/ruta/al/socket` (válido en Wayland), la app lo ignora, busca un `wayland-N` en `XDG_RUNTIME_DIR` y pisa la variable con ese. Puede mandar la ventana a otra sesión.
- Dónde: `app/electron/wayland.ts` línea 34 y 37 (`resolverWayland`)
- Arreglo: Si es absoluto y `esSocket(ruta)`, devolverlo igual con `forzarWayland: true`. Test en `tests/wayland-sesion.test.ts`.

**B142 · Con terminales que no esperan (por ejemplo `xfce4-terminal` por `$TERMINAL`), Actualizar da «se cerró la terminal» con el comando corriendo** (`SISTEMA-16`, severidad baja) · **ARREGLADO**
- Qué pasa: `xfce4-terminal -x` entrega la orden a su servidor y sale al instante. `enTerminal` toma esa salida como «cerró», resuelve con `terminalCerro`, relee `--version` antes de que termine `paru` y muestra un error falso.
- Dónde: `app/electron/actualizador.ts` líneas 97-103 (`enTerminal`); `app/electron/terminal-lanzar.ts` línea 19 (`BANDERA`)
- Arreglo: Agregar `--disable-server` a `xfce4-terminal`. Más general: si la terminal sale antes que la marca, seguir esperando la marca un rato en vez de resolver.

### Vistos trabajando esta noche

**B143 · El cierre por cupo de Gemini frenaba a Argon y a Claude por agy** (`NOCHE-1`, severidad alta) · **ARREGLADO**: con test en `app/tests/cierre-cupo-hook.test.ts`.
- Qué pasa: con la ventana del grupo `gemini` agotada, `pa -m agy:claude-…` y `pa -m gemini-4-argon-…` salían con «sin cupo» aunque sus grupos (`claude-gpt`, `gemini-4-argon`) estuvieran libres: el cierre se buscaba sólo por suscripción.
- Dónde: `app/electron/cli/cierre-cupo-lectura.ts` (`cierreDe`, `cierreDeModelo`) y `app/electron/cli/reparto.ts`.
- Arreglo: una entrada con `grupo` sólo cierra a los modelos de ese grupo (`grupoDeModelo`); `reparto` pasa el grupo del candidato.

**B144 · Nada frena lanzar más workers de los que el cupo aguanta** (`NOCHE-10`, severidad alta) · **PENDIENTE**
- Qué pasa: veinte workers lanzados a la vez contra una suscripción con cupo para pocas corridas pesadas arrancaron todos y murieron a mitad, sin commits. El cupo se mira al lanzar, no lo que ya está corriendo contra esa ventana.
- Dónde: `app/electron/cli/pa/orquesta.ts`, `app/electron/cli/reparto.ts`.
- Arreglo: tope de workers vivos por suscripción según el cupo libre y lo medido por corrida; los demás esperan en cola.

**B145 · Se pierde el mensaje final cuando un hook hace seguir el turno** (`NOCHE-15`, severidad alta) · **PENDIENTE**
- Qué pasa: el modelo cierra el turno con un resumen, un hook de fin de turno lo hace seguir, y en el chat queda sólo «Ran N commands» con el texto siguiente: el resumen desaparece (el lector de voz sí lo leyó).
- Dónde: `app/src/hilo/Lider.tsx` y `app/src/hilo/Turno.tsx` (cómo se agrupa el texto previo a una continuación).
- Arreglo: el texto anterior a una continuación por hook se conserva como mensaje propio; test con un transcript que tenga dos textos separados por la respuesta del hook.

**B146 · La nota antes de compactar ignoraba el `autoCompactWindow` del settings** (`NOCHE-2`, severidad media) · **ARREGLADO A MEDIAS**: hecho en los líderes; faltan los workers.
- Qué pasa: sin tope de Trama, el umbral de la nota se calculaba contra la ventana entera del modelo, así que la compactación nativa (más baja en el settings de Claude Code) llegaba antes y la nota no se pedía.
- Dónde: `app/electron/lider.ts`, `app/electron/contexto.ts`.
- Arreglo: leer el `autoCompactWindow` del settings al abrir el líder (`leerUmbralYa`) y usarlo cuando no hay tope propio. Falta lo mismo en los workers (`app/electron/cli/pa/lanzar.ts`).

**B147 · El «Mandar ya» a un líder de Codex viajaba sin marca** (`NOCHE-3`, severidad media) · **ARREGLADO**
- Qué pasa: el mensaje directo a un líder de Codex ocupado salía sin `trama_directo`, así que el puente lo encolaba al final y nunca devolvía el eco que la cola espera.
- Dónde: `app/electron/lider.ts` (`mandarDirecto`).
- Arreglo: marcarlo también para `codex`; el puente lo pone primero en el turno que sigue.

**B148 · «Fast mode disabled · Out of usage credits» aunque está apagado** (`NOCHE-4`, severidad media) · **ARREGLADO**: en la 0.3.19: apagar Fast relanza sin la opción.
- Qué pasa: con el modo rápido apagado en Trama el aviso sigue saliendo en el chat. Apagado no pasa ningún argumento, así que manda lo que tenga guardado el CLI.
- Dónde: `app/electron/esfuerzo-extras.ts` línea 101 (`argvFast`).
- Arreglo: pasar el apagado explícito cuando el modelo lo soporta y la persona lo apagó; comprobar en vivo que el aviso se va.

**B149 · Un worker en cola figura como «trabajando» y sin modelo** (`NOCHE-6`, severidad media) · **PENDIENTE**
- Qué pasa: un worker que espera puesto sale con estado `trabajando` y `modelo` vacío; hay que mirar `en_cola` para saberlo. La barra lo muestra como corriendo.
- Dónde: `app/electron/cli/pa/hilo.ts` (`pa --hilos --json`) y la barra.
- Arreglo: estado propio «en cola» con el modelo pedido.

**B150 · Aviso de «no terminó bien» con el worker terminado en 0** (`NOCHE-7`, severidad media) · **PENDIENTE**
- Qué pasa: un worker que cerró bien (rc 0, con commits) llegó al líder con el aviso de falla.
- Dónde: `app/electron/avisos-worker.ts`.
- Arreglo: decidir el texto por el código de salida y el estado final, con test de un worker que termina bien después de un reintento.

**B151 · `estado_workers` devuelve más de diez mil tokens** (`NOCHE-8`, severidad media) · **ARREGLADO**
- Qué pasa: la herramienta lista todos los hilos de todos los proyectos con su resultado entero, sin tope: una consulta de estado le cuesta al líder una parte grande del contexto.
- Dónde: `app/electron/cli/mcp-trama.ts`.
- Arreglo: tope de filas y de largo por resultado, filtro por proyecto y por estado, y decir cuántos quedaron afuera.

**B152 · Un brief con una ruta de afuera manda la corrida a otra suscripción sin avisar claro** (`NOCHE-11`, severidad media) · **PENDIENTE**
- Qué pasa: si el brief nombra una ruta fuera del proyecto, una dirección web o un comando de red, el worker pedido con otro motor corre en Claude. El aviso sale por la salida de error del lanzamiento y es fácil de perder: se gasta el cupo que se quería cuidar.
- Dónde: `app/electron/cli/pa/motores/privacidad.ts`, `app/electron/cli/pa/orquesta.ts`.
- Arreglo: decir en el aviso la línea exacta que lo disparó y ofrecer no lanzar (`--estricto`) en vez de cambiar de motor.

**B153 · Un worker interrumpido queda como «listo»** (`NOCHE-14`, severidad media) · **PENDIENTE**
- Qué pasa: un worker de agy cortado desde afuera termina con el texto «agy: interrupted» y sin informe, pero su estado dice `listo`, igual que uno que terminó bien.
- Dónde: `app/electron/cli/pa/hilo.ts` y el cierre de la corrida en `app/electron/cli/pa/otros-motores.ts`.
- Arreglo: estado propio para la corrida interrumpida (o `murio`) cuando el motor sale por señal o sin respuesta final.

**B154 · `reparto --cupos` muestra la ventana de 7 días de Gemini con el reinicio de la de 5 horas** (`NOCHE-5`, severidad baja) · **PENDIENTE**
- Qué pasa: tras renovarse la ventana de 5 horas, la de 7 días apareció en 0 % con la misma hora de vuelta; un rato después volvió a su valor real.
- Dónde: `app/electron/cli/reparto.ts` (lectura de los grupos de Google).
- Arreglo: no pisar una ventana con los datos de otra; test con las dos ventanas del mismo grupo.

**B155 · `pa --estado` arrastra «MURIÓ EN COLA» de hace semanas** (`NOCHE-9`, severidad baja) · **PENDIENTE**
- Qué pasa: la lista de un proyecto trae decenas de corridas muertas en cola de otros proyectos y de hace más de un mes, que tapan lo que corre ahora.
- Dónde: `app/electron/cli/pa/estado.ts`.
- Arreglo: mostrar sólo las del proyecto pedido y vencer las viejas (o resumirlas en una línea con la cuenta).

**B156 · Los workers lanzados desde un servicio no avisan a su líder** (`NOCHE-12`, severidad baja) · **PENDIENTE**
- Qué pasa: un `pa --async` lanzado con un entorno sin la sesión del líder termina sin avisarle a nadie; hay que mirar `pa --hilos` a mano.
- Dónde: `app/electron/cli/pa/lanzar.ts` (a quién se avisa al terminar).
- Arreglo: permitir decir a qué líder avisar (`--avisar-a <sid>`) y documentarlo.

**B157 · Un worker de arreglos se queda sin turnos a los cuatro bugs** (`NOCHE-13`, severidad baja) · **PENDIENTE**
- Qué pasa: el tope por tipo (50 turnos en `codigo-acotado`) corta una corrida con una lista larga de arreglos chicos, que deja el resto sin tocar y sin correr el chequeo final.
- Dónde: `app/electron/cli/pa/opciones.ts` (`topeDeTurnos`).
- Arreglo: que el brief o el tipo puedan pedir una lista («hasta N ítems») y el tope crezca con ella, o partir la lista sola en varias corridas en serie.

**B158 · Los workers sin líder aparecen colgados de otro líder** (`NOCHE-16`, severidad baja) · **PENDIENTE**
- Qué pasa: workers lanzados desde un servicio, sin sesión de líder, se dibujan bajo otro líder del mismo proyecto y al morir quedan ahí como «en cola, nunca arrancó · falló».
- Dónde: `app/src/barra/` (a qué líder se cuelga un worker).
- Arreglo: un grupo «sin líder» por proyecto, o colgarlos del líder que diga la corrida.

## Ideas

### Varios motores y gente nueva

**I001 · Arrancar con lo que tenés** (medio, cambia lo que se ve)
- Qué: El primer chat y los workers eligen entre los motores conectados y habilitados. Una sola suscripción o un modelo local alcanzan para empezar.
- Por qué: `app/electron/modelos-tipos.ts` define valores iniciales para Claude o «sólo Gemini»; `HOY.lider` sigue siendo Opus.
- Cómo: Generalizar `defaultsDe` y la elección inicial usando `conexion-modelos.ts`. Lo difícil es respetar elecciones guardadas y distinguir una desconexión momentánea de un proveedor ausente.

**I002 · Conectar ChatGPT de punta a punta** (medio, cambia lo que se ve)
- Qué: ChatGPT tiene estado real, conexión y comprobación tanto en la bienvenida como en Ajustes y el asistente nativo.
- Por qué: `Bienvenida.tsx` muestra siempre `bv.provSinDato` para ChatGPT; `AjustesCuentas.tsx` y `windows/src/pasos-nativo.js` sólo ofrecen Claude y Gemini.
- Cómo: Reutilizar `sondearCodex` de `app/electron/cuentas.ts` y ampliar los contratos de conexión de ambas carcasas. Lo difícil es cerrar todo el recorrido, incluido el regreso del navegador.

**I003 · Iniciar sesión sin consola** (grande, cambia lo que se ve)
- Qué: Conectar abre el navegador y muestra dentro de Trama el avance, la cancelación y el resultado.
- Por qué: `app/src/paneles/CuentasVarias.tsx` depende de una terminal para el login; `windows/src/pasos-nativo.js` llama a `abrirConsola`.
- Cómo: Crear adaptadores de autenticación por motor, aprovechando los mecanismos que admita cada programa. Lo difícil es manejar diferencias entre proveedores sin capturar contraseñas ni mostrar credenciales.

**I004 · Instalar el motor elegido** (grande, cambia lo que se ve)
- Qué: Si falta el programa del proveedor elegido, Trama ofrece instalarlo y comprobarlo desde la misma pantalla.
- Por qué: `AjustesCuentas.tsx` deshabilita Conectar cuando el programa no está instalado. `AjustesDsh.tsx` ya ofrece instalación, pero necesita npm.
- Cómo: Extender el patrón de `app/electron/dsh-ajustes.ts` con instaladores específicos y soporte nativo de ambas plataformas. Lo difícil es resolver dependencias, permisos y versiones compatibles sin pedir comandos.

**I005 · Elegir suscripción o API** (grande, cambia lo que se ve)
- Qué: Cada proveedor permite elegir explícitamente cómo conectarse: suscripción o clave de API. La pantalla aclara cuál se está usando.
- Por qué: `app/electron/claves.ts` no contempla claves de Anthropic, OpenAI o Google; `codex-puente.ts` elimina las claves de OpenAI del entorno.
- Cómo: Agregar modalidades de conexión en `claves.ts`, `modelos-tipos.ts` y los adaptadores. Lo difícil es separar sesiones, modelos disponibles y cobro, evitando cambiar de modalidad silenciosamente.

**I006 · No caer siempre en Claude** (grande, cambia lo que se ve)
- Qué: Cuando una tarea no puede usar el motor elegido, Trama busca una alternativa autorizada o explica cómo continuar con ese mismo proveedor.
- Por qué: `docs/reglas/internet-workers.md` establece que los candados de privacidad desvían tareas a Claude, aunque la persona sólo tenga otra suscripción.
- Cómo: Cambiar la resolución de alternativas en `app/electron/cli/pa/motores/chequeo.ts` y `privacidad.ts`. Lo difícil es conservar las restricciones de privacidad sin imponer un proveedor.

**I007 · Permisos de red por tarea** (grande, cambia lo que se ve)
- Qué: Una persona que sólo usa Gemini o ChatGPT puede autorizar una descarga o instalación necesaria para un worker, con alcance concreto.
- Por qué: `docs/reglas/internet-workers.md` distingue búsqueda web de lectura y bloqueo de comandos de red; pedidos con URL o instalación pueden terminar desviados a Claude.
- Cómo: Separar red, lectura externa y secretos en `privacidad.ts`, los lanzadores y hooks. Lo difícil es aplicar permisos equivalentes en todos los motores y plataformas.

**I008 · Llevar las imágenes al cambiar** (grande, cambia lo que se ve)
- Qué: El motor nuevo recibe las imágenes relevantes del chat. Si no admite imágenes, Trama explica esa limitación antes del cambio y conserva sus referencias.
- Por qué: `app/electron/relevo-motor.ts`, en `dichoDe`, reemplaza cada imagen por el texto `[imagen]`.
- Cómo: Agregar adjuntos al relevo y entregarlos mediante los adaptadores de cada motor. Lo difícil es conservar archivos, controlar el tamaño y evitar volver a enviar imágenes innecesarias.

**I009 · Conservar las pruebas del trabajo** (medio, cambia lo que se ve)
- Qué: Al cambiar de motor se mantienen los resultados importantes: errores, verificaciones y archivos producidos.
- Por qué: `app/electron/relevo-motor.ts` resume cada herramienta en una línea y excluye lo que devolvió; el modelo nuevo puede saber que hubo un test sin conocer su resultado.
- Cómo: Incorporar resultados seleccionados y referencias a salidas completas en el relevo. Lo difícil es separar evidencia útil de volcados enormes o contenido sensible.

**I010 · Ver qué se va a transferir** (medio, cambia lo que se ve)
- Qué: Antes de cambiar, la persona ve qué mensajes entran, cuáles quedan afuera y puede conservar un pedido antiguo indispensable.
- Por qué: `relevo-motor.ts` limita el relevo a 40.000 caracteres, cada mensaje a 6.000 y prioriza lo reciente; devuelve una cantidad de mensajes omitidos.
- Cómo: Exponer una preparación del relevo desde `lider.ts` y mostrarla en el diálogo de cambio. Lo difícil es ajustar el contenido a la ventana del destino sin ocultar recortes.

**I011 · Cambio recuperable ante fallas** (medio, cambia lo que se ve)
- Qué: Si falla el cambio de motor o Trama se cierra durante el proceso, el chat permite continuar desde el último estado válido.
- Por qué: `cambiarDeMotor`, en `app/electron/lider.ts`, elimina el relevo anterior antes de construir el nuevo y luego modifica archivos de sesión y el historial de cambios.
- Cómo: Preparar archivos temporales y guardar una operación recuperable antes de reemplazar el estado vigente. Lo difícil es coordinar varios archivos sin duplicar mensajes.

**I012 · Permisos claros en ChatGPT** (grande, cambia lo que se ve)
- Qué: Elegir «preguntar antes de actuar» tiene un comportamiento explícito también en ChatGPT, con confirmaciones cuando el adaptador pueda ofrecerlas.
- Por qué: `app/electron/codex-puente.ts` traduce los modos a distintos aislamientos, pero configura siempre `approval_policy="never"`.
- Cómo: Revisar la integración de permisos en `codex-puente.ts` y `codex-stream.ts`. Lo difícil es ofrecer confirmaciones reales con el protocolo disponible y explicar cualquier diferencia restante.

**I013 · Saber qué reglas recibió cada motor** (medio, cambia lo que se ve)
- Qué: En el proyecto se puede comparar qué instrucciones se enviaron a Claude, Gemini y ChatGPT, con su origen y versión.
- Por qué: `EstadoLecturaMotores`, en `app/src/paneles/ProyectosMd.tsx`, separa solamente «Claude» y «otros»; no muestra lo efectivamente enviado a cada sesión.
- Cómo: Registrar las fuentes usadas por los adaptadores y mostrarlas por motor. Lo difícil es distinguir instrucciones enviadas por Trama de archivos que el programa carga por su cuenta.

**I014 · Reglas importantes siempre completas** (medio, cambia lo que se ve)
- Qué: Las instrucciones indispensables pueden marcarse para que entren completas, aunque el resto del documento necesite dividirse.
- Por qué: `app/electron/cli/pa/motores/prompt.ts` corta las instrucciones en los primeros 20.000 caracteres por defecto; una regla final puede quedar afuera.
- Cómo: Admitir secciones obligatorias y referencias al resto en `prompt.ts` y `ProyectosMd.tsx`. Lo difícil es conservar prioridades y compatibilidad con los documentos existentes.

**I015 · Resolver las mismas reglas anidadas** (medio, cambia lo que se ve)
- Qué: Una regla que importa otra regla llega de manera consistente a todos los motores; los imports sin resolver se señalan.
- Por qué: `app/electron/instrucciones-md.ts` resuelve un solo nivel de imports y `instruccionesDe` elige el primer archivo válido.
- Cómo: Compartir un resolvedor con `app/electron/cli/pa/motores/prompt.ts`, con límites de profundidad y detección de ciclos. Lo difícil es respetar carpetas, prioridades y límites seguros en Linux y Windows.

**I016 · Skills sin depender de Claude** (medio, cambia lo que se ve)
- Qué: Quien sólo usa Gemini o ChatGPT puede instalar y administrar instrucciones reutilizables desde una biblioteca propia de Trama.
- Por qué: `app/electron/cli/pa/skills-motores.ts` sincroniza hacia otros motores tomando como origen las skills y los plugins de Claude.
- Cómo: Incorporar fuentes propias de Trama y del proyecto al catálogo y la sincronización existente. Lo difícil es resolver nombres repetidos, actualizaciones y enlaces sin pisar instalaciones ajenas.

**I017 · Lecciones que no desaparezcan por antigüedad** (medio, cambia lo que se ve)
- Qué: Una lección importante se puede fijar y vincular con el archivo o la verificación que la respalda.
- Por qué: `app/electron/cli/pa/lecciones.ts` elimina las entradas más antiguas al superar 45 líneas y sólo incluye las últimas 12 en el contrato.
- Cómo: Agregar prioridad y referencias, manteniendo lectura del formato actual; editarlo desde `Lecciones.tsx`. Lo difícil es conservar lo durable dentro de un contexto acotado.

**I018 · Elegir motor para tareas auxiliares** (medio, cambia lo que se ve)
- Qué: Los títulos automáticos usan un proveedor habilitado o una alternativa local sin IA, según Ajustes.
- Por qué: `app/electron/titulo-chat.ts` fija Haiku en `MODELO_BARATO` y ejecuta Claude para generar títulos, independientemente del motor del chat.
- Cómo: Sustituir `correrBarato` por una elección común de proveedores disponibles, conservando el título recortado como respaldo. Lo difícil es evitar gastos inesperados y llamadas repetidas.

**I019 · Capacidades locales verdaderas** (medio, cambia lo que se ve)
- Qué: El selector anuncia únicamente las herramientas que tendrá ese modelo local con el programa elegido.
- Por qué: `app/src/hilo/motor-capacidades.ts` marca skills, MCP y subagentes como disponibles para locales; `lider-arma.ts` limita el perfil local a `Bash,Read,Edit`.
- Cómo: Obtener capacidades del perfil de ejecución y compartirlas entre ventana y motor. Lo difícil es distinguir programa, modelo y modalidad, sin una tabla demasiado general.

**I020 · Modo completamente local** (grande, cambia lo que se ve)
- Qué: Un ajuste permite trabajar sin conexiones externas, incluyendo funciones auxiliares y consultas automáticas. Las descargas quedan como acciones explícitas.
- Por qué: `CHANGELOG.md` 0.3.5 incorpora actualización de Artificial Analysis en segundo plano; `actualizacion-trama.ts` consulta releases y `titulo-chat.ts` puede llamar a Claude.
- Cómo: Aplicar una política común de conexión en esos servicios y los lanzadores. Lo difícil es cubrir todas las salidas de red conservando datos guardados útiles.

**I021 · Prender modelos locales desde Windows** (grande, cambia lo que se ve)
- Qué: Los servidores locales compatibles pueden iniciarse y detenerse desde Trama también en Windows.
- Por qué: `controlarServidorLocal`, en `app/electron/locales-deteccion.ts`, rechaza plataformas distintas de Linux y sólo administra servicios de systemd.
- Cómo: Agregar control nativo para servidores compatibles y mostrar sus capacidades en `LocalesDetectados.tsx`. Lo difícil es seguir procesos y liberar memoria; en Windows debe mantenerse la prohibición de ejecutar `ollama`.

**I022 · Probar una tarea completa** (medio, cambia lo que se ve)
- Qué: Después de conectar, una prueba opcional confirma que el motor puede responder y usar las herramientas necesarias en una carpeta de prueba.
- Por qué: `app/electron/dsh-ajustes.ts` comprueba proveedores consultando listas de modelos; eso no demuestra que una generación o una herramienta funcionen.
- Cómo: Extender las comprobaciones con una tarea mínima y resultados separados por capacidad. Lo difícil es limpiar lo creado y avisar antes si la prueba consume saldo.

**I023 · Avisar sólo lo que necesitás** (chico, cambia lo que se ve)
- Qué: Los avisos de preparación se ajustan a los proveedores y funciones elegidos: no piden instalar herramientas que la persona decidió no usar.
- Por qué: `app/electron/setup.ts` comprueba siempre Handy, agy, Ollama y el login de Claude, salvo que cada aviso se descarte.
- Cómo: Derivar las comprobaciones de preferencias explícitas y reutilizarlas en `AvisoSetup.tsx`. Lo difícil es diferenciar «no lo uso» de «lo necesito y dejó de funcionar».

**I024 · Revisar planes con tu único proveedor** (grande, cambia lo que se ve)
- Qué: La revisión de un plan puede usar otra sesión de la misma suscripción, una API o un modelo local habilitado.
- Por qué: `revisoresPermitidos`, en `app/electron/revision-plan.ts`, acepta solamente Claude, Gemini y Codex; excluye otros motores aunque puedan ser el único disponible.
- Cómo: Generalizar el corredor de revisión conservando lectura solamente, límites y cancelación. Lo difícil es ofrecer restricciones equivalentes y contexto suficiente para cada motor.

**I025 · Retomar la bienvenida pendiente** (chico, cambia lo que se ve)
- Qué: Cerrar la bienvenida permite continuar después desde el paso pendiente; «no volver a mostrar» queda como una elección separada.
- Por qué: `app/src/paneles/Bienvenida.tsx` marca la bienvenida como vista al cerrarla de cualquier manera, incluso con Escape, y no guarda el paso.
- Cómo: Guardar progreso y cierre definitivo en preferencias, reutilizando `bienvenida-pasos.ts`. Lo difícil es conservar coherencia cuando algunas elecciones ya se guardaron y otras se saltearon.

**I026 · Terminar el primer trabajo acompañado** (medio, cambia lo que se ve)
- Qué: Un recorrido opcional ayuda a elegir carpeta, abrir un chat y completar una primera tarea pequeña con el motor disponible.
- Por qué: `bienvenida-pasos.ts` termina en configuración; `app/src/guia/registro.ts` ofrece recorridos por controles, pero no acompaña una tarea hasta obtener un resultado.
- Cómo: Conectar bienvenida y guías mediante objetivos observables. Lo difícil es servir tanto a quien quiere conversar como a quien quiere trabajar sobre un proyecto.

**I027 · Separar desconexión de estado desconocido** (medio, cambia lo que se ve)
- Qué: Una demora de Google o ChatGPT muestra «no pude comprobarlo» y permite reintentar, sin tratarla automáticamente como falta de sesión.
- Por qué: `app/electron/conexion-modelos.ts` tolera un estado incierto de Claude, pero Google y OpenAI requieren `logueado === true` para aparecer conectados.
- Cómo: Reemplazar los booleanos por estados explícitos y adaptar los selectores. Lo difícil es conservar disponibilidad sin presentar como confirmado un login que no pudo verificarse.

**I028 · Idioma propio de cada conversación** (medio, cambia lo que se ve)
- Qué: Cada chat permite fijar su idioma de respuesta y conservarlo al cambiar de motor, aunque la interfaz use otro.
- Por qué: `app/electron/preferencias.ts` guarda el idioma de la interfaz; los prompts de `contexto-local.ts` piden inferir la respuesta del idioma del mensaje.
- Cómo: Guardar una preferencia por conversación en `lider-arma.ts` y transmitirla mediante los adaptadores y el relevo. Lo difícil es respetar pedidos puntuales y chats bilingües.

**I029 · Idioma desde la primera ventana** (medio, cambia lo que se ve)
- Qué: El asistente nativo y la app comienzan en el idioma del sistema cuando está disponible, con selector inmediato y preferencia persistente.
- Por qué: `app/electron/consulta.ts` usa inglés sin preferencia guardada; `windows/src/pasos-nativo.js` y `windows/src/ui/asistente.js` tienen textos de instalación escritos en español.
- Cómo: Compartir traducciones y elección inicial entre ambas carcasas y la bienvenida. Lo difícil es disponer de los textos antes de que arranque el motor.

**I030 · Corrector según cómo escribís** (chico, cambia lo que se ve)
- Qué: Ajustes permite elegir los idiomas del corrector independientemente del idioma de la interfaz.
- Por qué: `app/electron/corrector.ts` selecciona siempre español e inglés; `windows/src/corrector.js` replica esa regla.
- Cómo: Guardar una lista configurable de diccionarios disponibles y aplicarla en ambas carcasas. Lo difícil es manejar idiomas no instalados y actualizar la sesión sin reiniciar.

### Producto y flujo de trabajo

**I031 · Bandeja «Te toca» de todos los proyectos** (medio, cambia lo que se ve)
- Qué: Una sola lista con todo lo que espera a la persona, de todos los proyectos. Incluye preguntas del tablero, pruebas, ramas por revisar, mensajes programados que fallaron y cupos que volvieron. Va ordenada por urgencia y cada renglón se resuelve ahí mismo.
- Por qué: `PanelTablero.tsx` sólo muestra el proyecto del chat abierto (prop `carpeta`). La bandeja de `espera-aviso.ts` sólo cuenta líderes («2 líderes te esperan»). Con varios proyectos hay que entrar chat por chat para saber qué falta.
- Cómo: Una vista nueva que une `tablero-junto.ts` (que ya junta las máquinas), `pa --hilos` filtrado a `listo` y `decision`, y el estado de `programados.ts` (campo `error`). Lo difícil es el orden y no duplicar con el panel Tablero.

**I032 · Reglas de autointegrar por proyecto** (medio, cambia lo que se ve)
- Qué: Cada proyecto elige si integra solo, pregunta o nunca. Puede sumar un tope de tamaño del diff y una lista de rutas protegidas (migraciones, `package.json`, secretos) que siempre piden revisión.
- Por qué: `autointegrar.ts` tiene un único interruptor global (`autoIntegrar` en preferencias). `seguro.ts` decide con reglas fijas (terminó bien, tiene commits, hay tests registrados). No distingue una rama de 3 líneas de una que toca 40 archivos.
- Cómo: Sumar a `motivoNoSeguro` en `seguro.ts` un parámetro de política por proyecto, guardado en Ajustes (sección de Ramas). El diff se mide con `git diff --stat` en la cola de `enCola`. Lo difícil es la UI de excepciones sin abrumar.

**I033 · El líder integra, descarta y frena workers por MCP** (medio, cambia lo que se ve)
- Qué: El líder puede pedir integrar una rama, descartarla o parar un worker sin armar comandos de Bash. Trama le muestra a la persona un «¿Integrar la rama X?» con botón antes de ejecutar.
- Por qué: `app/electron/cli/mcp-trama.ts` expone sólo cuatro herramientas (`lanzar_worker`, `estado_workers`, `buscar_hilos`, `mandar_mensaje`). Todo lo demás depende de que el modelo acierte los flags de `pa`.
- Cómo: Agregar las herramientas en `mcp-trama.ts` y su registro (`mcp-trama-registro.ts`), llamando al mismo camino que usa `Ramas.tsx` (`AccionRama`). Va con confirmación en la ventana. Lo difícil es el permiso y que valga también en la carcasa de Windows (`windows/src/canales.json`).

**I034 · Prioridad y orden de la cola de workers** (medio, cambia lo que se ve)
- Qué: Los workers en cola se pueden subir, bajar o sacar de la cola desde la barra. También se puede marcar «urgente».
- Por qué: `cola-pa.ts` lee de `$PA_STATE` los archivos `<id>.cola` (motivo «tope global: 5 workers vivos»). La persona ve la espera pero no puede cambiar el orden.
- Cómo: Un archivo de prioridad por corrida que `pa` mire al soltar un puesto (`app/electron/cli/pa/`), más botones en la fila en cola. Lo difícil es el orden justo cuando también hay cupo por suscripción.

**I035 · Revisar una rama con otro modelo antes de integrar** (medio, cambia lo que se ve)
- Qué: En Ramas, un botón «Revisar con otro modelo» que lee el diff en sólo lectura y deja un veredicto corto en la fila. Otra opción es hacerlo obligatorio por proyecto antes de integrar solo.
- Por qué: En `Ramas.tsx` el único segundo juicio es el «analista», un líder aparte con el brief de todas las ramas. El revisor de otro modelo (`revision-plan.ts`, `correrRevisor`) existe sólo para planes.
- Cómo: Reusar `correrRevisor` con el diff de la rama como entrada y mostrar el resultado como un `Juicio` más (`src/datos/analista.ts`). Lo difícil es el tamaño del diff, que hay que recortar y avisar.

**I036 · Mensajes programados que se repiten o esperan un evento** (medio, cambia lo que se ve)
- Qué: Programar «todos los días 9:00» o «cuando termine el worker X». Hoy la hora sale una sola vez.
- Por qué: `programados.ts` guarda un `cuando` fijo por mensaje, y `RAPIDOS` en `programados-hora.ts` sólo ofrece «en 15 min», «en 1 h», «en 3 h», «mañana 9:00». Un recordatorio diario hay que reprogramarlo a mano. I068 sólo agrega condiciones.
- Cómo: Un campo `repetir` o `alTerminar` en `Programado` y su limpieza en `mensajeLimpio`. Se reprograma al disparar. Lo difícil es evitar bucles (tope de repeticiones y pausa si falla).

**I037 · Un programado que falla avisa y reintenta una vez** (chico, cambia lo que se ve)
- Qué: Si un mensaje programado no pudo salir, se reintenta una vez al rato. Si sigue fallando, avisa con notificación y no sólo con un error escondido.
- Por qué: El encabezado de `programados.ts` dice que un mensaje que falló «NO se reintenta solo» y queda con su `error` hasta que se saque. Ese error sólo se ve abriendo el globito de `AvisoProgramados.tsx`.
- Cómo: Un reintento con espera en `crearProgramados`, y un aviso por el camino de `espera-aviso.ts` cuando el reintento también falla. Lo difícil es distinguir un `claude` que no arranca de un fallo pasajero.

**I038 · Avisos configurables: por tipo, silencio y sonido** (medio, cambia lo que se ve)
- Qué: En Ajustes se elige qué avisa con notificación (pregunta, rama lista, falla, cupo), con qué sonido y en qué horario. Hay un modo «no molestar» con resumen al volver.
- Por qué: `espera-aviso.ts` sólo maneja el número de la bandeja y una notificación de escritorio por líder que espera. `avisos-worker.ts` tiene cinco tipos (`fin`, `falla`, `cupo`, `colgado`, `tanda`) y sólo hay un modo global de tanda o por worker.
- Cómo: Una tabla de reglas en preferencias que `espera.ts` y `avisos-worker.ts` consulten antes de anunciar. Lo difícil es respetarlo igual en Windows (carcasa) y en el celular.

**I039 · Resumen «mientras no estabas» al abrir Trama** (chico, cambia lo que se ve)
- Qué: Al abrir la app, una tarjeta resume lo que pasó durante la ausencia: workers que terminaron, ramas integradas solas, fallas, cupos que volvieron. Cada renglón lleva un link.
- Por qué: `avisos-pendientes.ts` ya arma un resumen de lo que terminó mientras el líder no estaba, pero va dentro del chat de ese líder. La persona que vuelve a la mañana no tiene una vista general.
- Cómo: Reusar `integradas` y `fallas` de `auto.json` (`autointegrar.ts`) y las entradas `entregado` de avisos-pendientes, filtradas desde la última vez que se abrió la ventana. Lo difícil es no repetirse con la bandeja de la idea 1.

**I040 · Buscar dentro del contenido de los chats del Historial** (grande, cambia lo que se ve)
- Qué: El buscador del Historial (Ctrl+H) encuentra también lo que se dijo adentro del chat. Es útil para «¿dónde decidimos lo del login?».
- Por qué: `src/barra/Historial.tsx` filtra por título, carpeta y estado (`filtrarHistorial({q, filtro, nombre, carpeta})`). `historial.ts` indexa «sólo números y nombres» de los transcripts, nunca el texto.
- Cómo: Un índice de texto local y opcional, apagado por defecto, en `$HILOS_STATE/historial/`. Se arma incremental como el actual (de a trozos). Lo difícil es el peso en disco y no guardar secretos que aparezcan en los chats.

**I041 · Registro de debates y revisiones por proyecto** (medio, cambia lo que se ve)
- Qué: Cada debate o revisión que concluye se guarda con «Qué se acordó», quién dijo qué y qué plan salió. Se puede consultar después por proyecto.
- Por qué: `docs/modo-debate-diseno.md` guarda la conclusión en `revisiones-pendientes.json` sólo hasta que entra por la cola y la borra al entregarla. Después queda sólo como tarjeta en el chat de ese líder.
- Cómo: Un `debates.jsonl` por proyecto escrito en el cierre de `debate-trabajo.ts` y una solapa en el Historial. Lo difícil es que no se confunda con la «memoria compartida» ya planeada: éste guarda hechos, no instrucciones.

**I042 · Analista de Ramas automático y configurable** (chico, cambia lo que se ve)
- Qué: El analista corre solo cuando se juntan N ramas por revisar y con el modelo que se elija en Ajustes. Hoy hay que lanzarlo.
- Por qué: En `Ramas.tsx` el analista es un líder aparte (`rol: "analista"`, el prop `analista: Lider | null`) que recibe el brief de todas las ramas. Su modelo y su arranque no se configuran desde Ajustes.
- Cómo: Una preferencia con umbral y modelo, y un disparo en `paneles.ts` cuando la lista de `pa --hilos` cruza el umbral. Lo difícil es no gastar cupo si ya hay un veredicto vigente (`analisisVigente` en `ramas-vista`).

**I043 · Predecir choques entre ramas y sugerir orden de integración** (medio, cambia lo que se ve)
- Qué: Ramas muestra qué ramas tocan los mismos archivos y propone un orden («integrá primero A, después B»). Así se evita el 80 de conflicto.
- Por qué: `autointegrar.ts` sólo reacciona después: ante un rc 80 lanza un `--actualizar --async` y reintenta una vez. Dos ramas chocan recién al integrar la segunda.
- Cómo: Cruzar los archivos de `git diff --name-only <base>..<rama>` de cada fila de `pa --hilos` y marcarlas en `Ramas.tsx`. Lo difícil es el costo con muchas ramas (cachear por commit).

**I044 · Cuando un worker muere por cupo, ofrecer retomarlo en otro proveedor** (medio, cambia lo que se ve)
- Qué: El aviso de corte por cupo trae un botón «Seguir con otro modelo» que relanza con la rama y el resumen del worker caído.
- Por qué: `avisos-worker.ts` ya tiene el tipo `cupo` (con `proveedor` y `vuelve`), y la señal está documentada en `motor/docs/protocolo-cierre-cupo.md`. `Ramas.tsx` sólo permite retomar con un líder nuevo (`src/datos/retomar.ts`) y recién desde la rama.
- Cómo: Un botón en la tarjeta del aviso que llame al mismo camino de `alRetomar`, con `reparto` eligiendo un proveedor con cupo. Lo difícil es respetar la regla de no rotar cuentas para esquivar límites: sólo cambia de modelo o proveedor, nunca de cuenta.

**I045 · Carrera entre dos modelos para la misma tarea** (grande, cambia lo que se ve)
- Qué: Lanzar el mismo brief a dos modelos y quedarse con el mejor resultado. La otra rama se descarta con un toque.
- Por qué: `lanzar_worker` (`mcp-trama.ts:96`) lanza una corrida por pedido. Comparar modelos se hace a mano y sin ver las ramas lado a lado.
- Cómo: Un `grupo` común en los dos workers y una vista de comparación en `Ramas.tsx` (tests, tamaño del diff, resumen). Lo difícil es el gasto doble de cupo, que tiene que ser opt-in con el costo a la vista.

**I046 · Línea de tiempo del proyecto** (medio, cambia lo que se ve)
- Qué: Una vista cronológica de lo que pasó hoy en el proyecto: workers lanzados, integraciones (con su modelo), reversiones, debates, fallas.
- Por qué: La información está desperdigada: `auto.json` (integradas y fallas, tope 50), `eventos.jsonl` (`avisos-worker.ts`), `salud-eventos.ts` y los chats. Nada la junta en orden.
- Cómo: Una lectura unificada de esas fuentes, ordenada por `ts`, en un panel acoplable. Lo difícil es el tope de 50 de `autointegrar.ts`, que obligaría a guardar más.

**I047 · Tope de workers por proyecto y por suscripción** (chico, cambia lo que se ve)
- Qué: Ajustes deja poner «máximo 2 workers a la vez en este proyecto» y «máximo 3 de Gemini». El resto espera en cola con el motivo escrito.
- Por qué: `cola-pa.ts` muestra motivos como «tope global: 5 workers vivos» y «los 3 puestos ocupados»: el tope es uno global. Un proyecto grande puede ocupar todos los puestos.
- Cómo: Más claves de tope en la configuración que lee `pa` al lanzar. Complementa I061, que mide por cupo. Lo difícil es explicar en la fila en cola cuál de los topes la frena.

**I048 · Botón «Pausar todo»** (chico, cambia lo que se ve)
- Qué: Un interruptor que frena nuevos lanzamientos y la cola sin matar lo que corre, para cuando la persona se va o se acaba el cupo.
- Por qué: Hoy se frena de a uno (`frenado_en` en `FilaWorker`, `pa --parar`). Con diez workers en cola y un cupo por agotarse no hay forma de detener todo de un toque.
- Cómo: Un archivo de pausa que `pa` revise antes de arrancar cada puesto de la cola, más el botón en el riel. Lo difícil es el aviso de que está pausado y la reanudación segura.

**I049 · Revisar el brief antes de lanzar** (chico, cambia lo que se ve)
- Qué: Antes de lanzar un worker, Trama avisa si al brief le falta algo (qué archivos, cuándo está listo, cómo verificar). También avisa si otro worker vivo trabaja sobre los mismos archivos.
- Por qué: Los briefs buenos tienen esas secciones, pero nada las exige al lanzar: `lanzar_worker` sólo recibe el texto. El choque entre workers se descubre recién al integrar.
- Cómo: Un chequeo liviano en la confirmación de `lanzar_worker` (y en `PasoLanzar.tsx`), configurable y apagable. Lo difícil es no ser molesto: sólo avisar, nunca bloquear.

**I050 · Ramas viejas: aviso y limpieza sugerida** (chico, cambia lo que se ve)
- Qué: Ramas sin tocar desde hace N días se marcan «vieja» y se ofrecen para limpiar en lote, como ya se hace con el tablero.
- Por qué: Este repo tiene 9 ramas `pa/trama/*` sin integrar. `Ramas.tsx` las lista sin distinguir las de hoy de las de hace semanas. Hay una limpieza en lote para el tablero (`LimpiarTablero.tsx`, regla en `docs/reglas/tablero.md`) pero no para ramas.
- Cómo: Un filtro de edad en `ramas-vista` y un diálogo copiado de `LimpiarTablero` (cierra a descartado, nunca borra de golpe, con deshacer). Lo difícil es no descartar trabajo valioso: sólo viene marcado lo sin commits o ya integrado en otra rama.

**I051 · Convertir un pendiente del tablero en worker** (chico, cambia lo que se ve)
- Qué: En el panel Tablero, un pendiente tiene «Lanzar como worker», que pre-arma el brief con el texto del item y la carpeta del proyecto.
- Por qué: `PanelTablero.tsx` sólo deja contestar preguntas y cerrar items (`contestar`, `cerrar`). Un pendiente que es trabajo hay que copiarlo a mano al chat.
- Cómo: Un botón que abra `PasoLanzar` con el texto cargado y deje la clave del item en el worker para cerrarlo al integrar. Lo difícil es el vínculo de vuelta: el item se cierra solo cuando la rama se integra.

**I052 · Tildar todas las pruebas ofrece integrar o cerrar la rama** (chico, cambia lo que se ve)
- Qué: Al tildar el último renglón de un PROBAR de un worker, la tarjeta pregunta «¿Integro la rama?» o «¿La cierro?».
- Por qué: `docs/reglas/tablero.md` dice que tildar todos los renglones marca el item `hecho`, y el renglón de un worker lleva clave `pa:<id>:…`. Ahí termina: la rama sigue en Ramas esperando otra acción.
- Cómo: En `tildarRenglon` (`tablero-renglones.ts`), al quedar todo tildado, ofrecer la acción de `AccionRama` de ese worker. Lo difícil es ubicar la rama correcta cuando un `--seguir` anotó con el id de la corrida original (límite ya documentado).

**I053 · Responder desde la notificación** (medio, cambia lo que se ve)
- Qué: La notificación de escritorio de una pregunta con opciones trae botones para contestar sin abrir la ventana. En el celular, lo mismo.
- Por qué: `espera-aviso.ts` define `AvisoEspera` con `sid`, `titulo`, `cuerpo`: tocarla sólo abre el líder. Las preguntas de tablero con opciones ya se contestan con un toque en el panel.
- Cómo: Acciones de notificación nativas (Electron las soporta en Linux y Windows con límites) y un canal que reuse `fuenteTablero.responder`. Lo difícil es la compatibilidad de acciones entre sistemas y el modo remoto.

**I054 · Resumen de proyecto en la cabecera del chat** (chico, cambia lo que se ve)
- Qué: Arriba del chat de un líder, una línea chica: «2 workers · 3 ramas por revisar · 1 pregunta». Un toque abre cada cosa.
- Por qué: Para ver el estado del proyecto del chat hay que abrir por separado Ramas, el panel Tablero, la barra y los cupos. Cada pieza (`PanelTablero`, `Ramas`, riel) conoce sólo lo suyo.
- Cómo: Un selector que junte `gruposDelProyecto` (`panel-tablero-logica.ts`), `ramas()` (`ramas-vista`) y la lista de workers por `jefe_id`. Lo difícil es mantenerlo barato y no llenar la cabecera.

**I055 · Ofrecer cambiar de modelo cuando se acaba el cupo de un chat** (medio, cambia lo que se ve)
- Qué: Con el modelo del chat en el tope de cupo, Trama ofrece «Seguir con X, que tiene lugar» (con relevo), además de ofrecer otra cuenta.
- Por qué: `docs/reglas/lideres.md` dice que `OfertaCuenta` sólo ofrece pasar a otra cuenta del mismo proveedor (Claude) con ≥ 80 %. El «Seguir con otro modelo» existe (`SeguirCon`) pero la persona tiene que buscarlo.
- Cómo: Extender `ofertaDeCambio` (`barra/cupos-riel-logica.ts`) con candidatos de otro proveedor con cupo, abriendo `SeguirCon`. Lo difícil es no empujar a proveedores que la persona no tiene: sólo los conectados.

**I056 · Rastro de cada integración: quién, qué modelo y qué dijo** (chico, cambia lo que se ve)
- Qué: El mensaje del merge y el detalle en Ramas llevan el modelo que hizo el trabajo, el RESULTADO y la verificación del worker. Así, meses después, se sabe por qué está ese cambio.
- Por qué: `avisos-worker.ts` ya arma `resumen` con `compactarResultado` (RESULTADO, VERIFICACION, DECISION, SIGUE; ≤ 1500 caracteres), pero eso muere en el aviso. `auto.json` guarda sólo id, proyecto, tarea y hora.
- Cómo: Guardar el resumen junto a la integración (`Integrada` en `autointegrar.ts`) y mostrarlo al desplegar la fila de Ramas. Sin nombres de modelos en el commit, por la regla del repo: queda en el registro de Trama, no en git.

**I057 · Silenciar un líder o un proyecto con resumen al volver** (chico, cambia lo que se ve)
- Qué: Un líder que corre una tanda larga se silencia: no manda avisos ni notificaciones. Al terminar deja un solo resumen.
- Por qué: `ModoAvisoLider` es global («tanda» o «worker»). Una tanda nocturna con 20 workers sigue generando notificaciones y avisos. I067 agrupa por causa, pero no silencia por líder.
- Cómo: Un indicador por líder en `lideres.json` que consulte `avisos-pendientes.ts` antes de `entregar`. Lo difícil es no silenciar lo crítico (cupo agotado, decisión que bloquea).

**I058 · Seguir desde un chat del Historial con un resumen** (medio, cambia lo que se ve)
- Qué: En el Historial, un chat cerrado tiene «Seguir en uno nuevo», que arranca un líder con el resumen de traspaso del anterior. Hoy sólo se puede abrir o borrar.
- Por qué: `historial-chats.ts` sólo ofrece abrir o borrar (manda el transcript a la papelera). Para retomar un tema hay que reabrir un chat enorme con la caché fría. `resumen-traspaso.ts` ya existe para el relevo entre modelos.
- Cómo: Reusar `resumen-traspaso.ts` desde la acción del Historial y abrir un líder nuevo con ese texto. Lo difícil es elegir el modelo del resumen sin gastar cupo de más.

**I059 · Ver el árbol de ramas de un chat** (medio, cambia lo que se ve)
- Qué: Cuando un chat se bifurca («Seguir con otro modelo» o ramas de conversación), la barra muestra de dónde salió cada uno y deja saltar entre ellos.
- Por qué: `lider.ts` (~línea 1903) implementa la bifurcación con `--fork-session`, o con un relevo si cambia el motor. Pero la barra los muestra como chats sueltos, sin relación visible.
- Cómo: Guardar el `origen` (sid del chat padre) en `Guardado` de `lideres.json` y dibujar el parentesco en `barra/arbol.ts`. Lo difícil es el relevo entre motores, que no tiene un sid padre único.

**I060 · Recetas: flujos guardados con pasos** (grande, cambia lo que se ve)
- Qué: La persona guarda un flujo repetido como «auditar un área → elegir hallazgos → arreglar → integrar». Lo lanza con un toque y cada paso pide confirmación donde la persona quiera.
- Por qué: Ese flujo hoy «se arma a mano con briefs», según I065. Cada vez se reescribe el pedido y se pierde qué modelo y esfuerzo funcionaron.
- Cómo: Un archivo de recetas por usuario o proyecto, con pasos de `lanzar_worker` y puntos de pausa, ejecutado desde el proceso principal y visible en el panel Tablero. Lo difícil es el diseño del paso «elegir» sin duplicar I065 (auditar de punta a punta), que es el caso más conocido de una receta.

### Técnica y robustez

**I061 · Guardado resistente a bloqueos** (medio, no cambia lo que se ve)
- Qué: Que guardar una cola, un líder o un ajuste soporte los bloqueos breves del antivirus.
- Por qué: `app/electron/pa.ts:86` escribe y renombra sin reintentos; `app/electron/cli/base/archivo.ts` ya contempla EBUSY, EPERM y EACCES. La protección depende de qué función use cada módulo.
- Cómo: Compartir la implementación resistente, conservando la serialización por archivo de `pa.ts`. Lo difícil es preservar los contratos de texto y los errores actuales.

**I062 · Guardado durable ante apagones** (medio, no cambia lo que se ve)
- Qué: Proteger mejor los mensajes pendientes y la configuración ante un corte de luz.
- Por qué: Las escrituras atómicas de `app/electron/cli/base/archivo.ts` hacen archivo temporal y renombrado, pero no sincronizan explícitamente el contenido con el disco.
- Cómo: Agregar escritura durable para datos críticos y agrupar cambios frecuentes. Lo difícil es resolver las garantías disponibles en cada sistema sin frenar cada tecla.

**I063 · Recuperar la última copia válida** (medio, cambia lo que se ve)
- Qué: Recuperar colas y ajustes dañados desde una copia buena, con un aviso de qué se recuperó.
- Por qué: `app/electron/cola-respaldo.ts` conserva el archivo ilegible, pero permite seguir con la cola vacía. `cli/base/archivo.ts` devuelve el valor por defecto ante JSON roto.
- Cómo: Mantener generaciones validadas y ofrecer restauración desde Ajustes. Lo difícil es distinguir corrupción de una versión futura que todavía no se entiende.

**I064 · Confirmar que Trama funciona** (medio, no cambia lo que se ve)
- Qué: Considerar buena una actualización cuando el chat y el motor estén operativos.
- Por qué: `app/electron/main.ts:280` confirma el arranque al cargar la página. `windows/src/main.js` también acepta la primera página, incluso el asistente.
- Cómo: Confirmar desde React después de leer el estado y completar una llamada al motor. Lo difícil es definir una prueba local que funcione sin internet ni proveedores conectados.

**I065 · Confirmar el final del instalador** (medio, cambia lo que se ve)
- Qué: Evitar mostrar «instalada» cuando el instalador murió antes de terminar.
- Por qué: `app/electron/actualizacion-trama.ts:492` puede concluir «hecho» porque había un PID y el log no contiene un aviso reconocido.
- Cómo: Exigir un comprobante final con versión, identificador de instalación y resultado; verificar también los archivos instalados. Lo difícil es que el comprobante sobreviva al reinicio del motor y tenga equivalente en Windows.

**I066 · Chats con cantidad acotada de elementos** (grande, no cambia lo que se ve)
- Qué: Que recorrer miles de mensajes no acumule miles de elementos en pantalla.
- Por qué: `app/src/hilo/Lider.tsx:2056` dibuja todos los elementos cargados con `items.map`. El paginado y la memoización existentes no ponen un límite al contenido acumulado al subir.
- Cómo: Mantener montados los turnos cercanos a la vista y conservar espacios medidos. Lo difícil es preservar la posición con imágenes, mensajes de altura variable y enlaces a revisiones.

**I067 · Guardar secretos sin pisarlos** (medio, no cambia lo que se ve)
- Qué: Que agregar una clave no borre otra ni pierda un cambio simultáneo.
- Por qué: `app/electron/claves.ts` reconstruye el archivo con `NOMBRES_CLAVE` y claves MCP. `reporte-anonimo.ts` necesita además `TRAMA_REPORTES_CLAVE`, que no está en esa lista; las operaciones tampoco comparten un candado de lectura y escritura.
- Cómo: Centralizar los nombres admitidos y actualizar bajo un mismo candado, con temporal único. Lo difícil es conservar todos los consumidores sin devolver valores secretos a la interfaz.

**I068 · Conservar adjuntos todavía usados** (medio, cambia lo que se ve)
- Qué: Que un archivo adjunto siga disponible mientras lo necesite un borrador o un mensaje pendiente.
- Por qué: `app/electron/archivos.ts` limpia adjuntos por antigüedad de siete días. `borradores.ts` conserva sus rutas y descarta los que desaparecieron.
- Cómo: Limpiar por referencias y aplicar la antigüedad sólo a archivos sin uso. Lo difícil es coordinar borradores, colas y mensajes mientras la limpieza está corriendo.

**I069 · Reconocer cada envío al recuperarse** (grande, cambia lo que se ve)
- Qué: Resolver mejor si un mensaje llegó antes de un corte, incluso cuando se repite el mismo texto.
- Por qué: `app/electron/nucleo.ts:405` verifica la entrega comparando texto y posición contra los últimos 60 mensajes. La cola ya recupera envíos, pero esa comprobación puede quedar sin certeza.
- Cómo: Persistir un identificador de envío y asociarlo con el eco o UUID que permita cada motor. Lo difícil es adaptar proveedores que no devuelven identificadores propios.

**I070 · Limpiar secretos antes del log** (medio, no cambia lo que se ve)
- Qué: Que las claves queden ocultas también en los registros locales.
- Por qué: `app/electron/reporte.ts` limpia el log al exportarlo; `bitacora.ts` escribe el detalle recibido y `contencion.ts` incorpora errores de consola.
- Cómo: Aplicar una limpieza común antes de escribir al archivo o a stderr, cubriendo también `windows/src/main.js`. Lo difícil es ocultar secretos sin quitar el contexto útil del error.

**I071 · Volver a una instalación completa** (grande, no cambia lo que se ve)
- Qué: Que regresar a la versión anterior restaure también sus dependencias compatibles.
- Por qué: `app/electron/version-anterior.ts` respalda `dist`, `dist-electron` y `package.json`, pero excluye `node_modules`. Una vuelta puede combinar código anterior con dependencias nuevas.
- Cómo: Preparar instalaciones completas por versión y cambiar cuál está activa; comprobar el mismo contrato en el paquete nativo de Windows. Lo difícil es el espacio ocupado y los archivos abiertos.

**I072 · Barrer procesos tras un crash en Windows** (grande, no cambia lo que se ve)
- Qué: Evitar que herramientas de líderes caídos sigan consumiendo recursos.
- Por qué: `app/electron/huerfanos.ts` recupera y barre descendientes etiquetados en Linux, pero es una operación vacía en Windows. `procesos.ts` usa `taskkill` para el cierre solicitado.
- Cómo: Dar a Windows una supervisión equivalente mediante Job Objects, manteniendo separados los workers que deben sobrevivir. Lo difícil es conservar esa independencia y no abrir consolas.

**I073 · Identificar procesos sin confundirlos** (medio, no cambia lo que se ve)
- Qué: No tomar un proceso ajeno por un motor o worker anterior.
- Por qué: `app/electron/local.ts` devuelve `"win"` como identidad de arranque en Windows. Eso no distingue dos procesos que usaron el mismo PID en momentos diferentes.
- Cómo: Registrar la hora real de creación del proceso y compartir esa identidad con los archivos de dueño y corrida. Lo difícil es obtenerla de forma nativa y tolerar procesos que desaparecen durante la consulta.

**I074 · Recuperarse de excepciones fatales** (medio, cambia lo que se ve)
- Qué: Que una falla grave deje un diagnóstico y recupere el motor de forma controlada.
- Por qué: `app/electron/contencion.ts` registra `uncaughtException` y mantiene el proceso andando. Después de una excepción no siempre se puede garantizar que el estado siga coherente.
- Cómo: Separar errores recuperables de fallas fatales, guardar lo pendiente con un tope y reiniciar con protección contra bucles. Lo difícil es evitar envíos repetidos y preservar workers independientes.

**I075 · Memoria limitada por peso** (medio, no cambia lo que se ve)
- Qué: Mantener un consumo de memoria previsible al alternar entre chats grandes.
- Por qué: `app/electron/conv-cache.ts` limita la caché a ocho sesiones; `lider-arma.ts` conserva mensajes y mapas completos. Ocho sesiones pueden tener tamaños muy distintos.
- Cómo: Agregar un presupuesto por bytes estimados, configurable, y desalojar sesiones según uso y peso. Lo difícil es contar estructuras compartidas y no provocar relecturas continuas.

**I076 · Leer chats sin trabar el motor** (grande, no cambia lo que se ve)
- Qué: Que abrir un transcript enorme no demore otros chats o pedidos de la ventana.
- Por qué: `app/electron/conv-cache.ts` lee bloques de hasta 4 MB y llama a `avanzarConv`; `lider-arma.ts` analiza sus líneas con `JSON.parse` en el mismo proceso.
- Cómo: Medir el bloqueo y mover el análisis pesado a un worker o repartirlo en tandas con cesión de ejecución. Lo difícil es conservar el orden ante compactaciones y reescrituras.

**I077 · Páginas que no recorran todo el chat** (medio, no cambia lo que se ve)
- Qué: Cargar mensajes anteriores con un costo más parejo.
- Por qué: `app/electron/lider-arma.ts:1289` filtra toda la conversación y busca los últimos mensajes relevantes para armar cada página.
- Cómo: Mantener índices de mensajes visibles y datos finales, actualizados al incorporar líneas. Lo difícil es invalidarlos correctamente al volver atrás o cambiar de motor.

**I078 · Índice de corridas para la barra** (grande, no cambia lo que se ve)
- Qué: Actualizar la lista de workers sin revisar todo el historial en cada cambio.
- Por qué: `app/electron/cli/pa/hilos.ts` recorre carpetas y extensiones, y obtiene hechos por corrida. `pa.ts` evita ejecuciones simultáneas, pero vuelve a pedir la lista completa.
- Cómo: Cachear los metadatos de corridas terminadas y recalcular las cambiadas, con reconstrucción disponible. Lo difícil es detectar cambios hechos desde una terminal sin alterar el formato actual.

**I079 · Reanudar según los recursos disponibles** (medio, cambia lo que se ve)
- Qué: Que recuperar varios líderes no sature la computadora al abrir Trama.
- Por qué: `app/electron/lider.ts:2542` escalona los líderes seleccionados con una espera fija de 150 ms; esa espera no considera memoria disponible ni procesos que todavía están arrancando.
- Cómo: Limitar arranques simultáneos y priorizar el chat visible, las colas y los líderes con workers. Lo difícil es adaptar la recuperación sin dejar trabajo necesario esperando indefinidamente.

**I080 · Acotar el canal de los candados** (chico, no cambia lo que se ve)
- Qué: Evitar que una conexión incompleta consuma memoria indefinidamente.
- Por qué: `app/electron/cli/base/lock.ts:87` acumula datos hasta encontrar un salto de línea. Ese receptor no establece un máximo de bytes ni un plazo para completar el mensaje.
- Cómo: Limitar tamaño, conexiones y tiempo de espera en sockets y named pipes. Lo difícil es no cortar operaciones válidas del canal de control.

**I081 · Acotar el historial de eventos por bytes** (medio, no cambia lo que se ve)
- Qué: Mantener estable la memoria usada para reconectar ventanas y celulares.
- Por qué: `app/electron/remoto.ts` limita la repetición a 5000 eventos. Ya limita el atraso de cada conexión, pero el historial compartido se cuenta por cantidad, aunque los eventos pesen distinto.
- Cómo: Agregar un presupuesto por bytes y solicitar resincronización cuando el historial necesario se descarte. Lo difícil es conservar correctamente el orden y las épocas.

**I082 · Registrar errores sin frenar la app** (medio, no cambia lo que se ve)
- Qué: Evitar que una ráfaga de errores agregue pausas por escrituras al disco.
- Por qué: `app/electron/bitacora.ts` crea carpetas, rota y agrega entradas con operaciones síncronas. `windows/src/main.js` también agrega su log de forma síncrona.
- Cómo: Escribir mediante una cola acotada, con descarga final y una salida mínima para fallas fatales. Lo difícil es conservar errores importantes cuando el disco está lento o lleno.

**I083 · Reportes con las fuentes necesarias** (medio, cambia lo que se ve)
- Qué: Que un reporte incluya el contexto del instalador y de la carcasa cuando corresponda.
- Por qué: `app/electron/reporte.ts` recoge sólo `trama.log` y `ventana.log`, sin sus rotaciones. Windows registra además en `carcasa.log`, según `windows/src/main.js`.
- Cómo: Reunir fuentes según plataforma y tipo de problema, sumar eventos de salud y mostrar qué se adjunta. Lo difícil es unificar rutas y limpiar todo antes de exportarlo.

**I084 · Reportes pendientes sin conexión** (medio, cambia lo que se ve)
- Qué: Guardar un reporte preparado y poder enviarlo cuando vuelva internet.
- Por qué: `app/electron/reporte-anonimo.ts` devuelve un error ante una falla de red; el envío no tiene una bandeja persistente.
- Cómo: Guardar localmente lo autorizado, permitir cancelar y usar un identificador para evitar duplicados al reintentar. Lo difícil es distinguir un envío perdido de una respuesta perdida.

**I085 · Diagnóstico local de lentitud** (medio, cambia lo que se ve)
- Qué: Ver si una demora viene del arranque, la memoria, el disco o un bloqueo del motor.
- Por qué: `app/electron/salud-eventos.ts` registra cuatro clases de eventos; `reinicio-marcas.ts` aporta tiempos del reinicio, pero no describe recursos ni bloqueos durante el uso.
- Cómo: Ampliar Salud con mediciones locales acotadas, identificadores de operación y retención configurable. Lo difícil es medir con poco costo y sin guardar contenido de chats.

**I086 · Probar la ventana nativa de Windows** (medio, no cambia lo que se ve)
- Qué: Detectar antes de publicar cuando el motor pasa las pruebas pero la interfaz no funciona en Windows.
- Por qué: `.github/workflows/ci.yml` ejecuta la prueba de acciones mediante CDP en Linux; el trabajo de Windows corre tests y humo del motor, sin ese recorrido de la ventana.
- Cómo: Agregar un recorrido nativo con proveedores falsos: abrir chat, escribir, adjuntar y reconectar. Lo difícil es aislar perfiles y comprobar que no aparecen consolas.

**I087 · Frenar regresiones de rendimiento** (medio, no cambia lo que se ve)
- Qué: Detectar una versión que vuelve lentos los chats largos antes de distribuirla.
- Por qué: `app/scripts/medir-larga.mjs` ya mide apertura, escritura y scroll, pero sólo imprime números. `.github/workflows/ci.yml` no lo ejecuta.
- Cómo: Hacerlo portable, comparar conversación larga contra corta y guardar resultados en CI. Lo difícil es fijar márgenes útiles sin fallar por variaciones normales de las máquinas.

**I088 · Probar cortes en momentos precisos** (grande, no cambia lo que se ve)
- Qué: Comprobar que mensajes y estado sobreviven a una muerte real del proceso.
- Por qué: `app/tests/lider-reinicio.test.ts` simula el reinicio con otra copia del módulo; `cola-sin-perder.test.ts` usa un disco en memoria. Son bases útiles, pero esos casos no ejercitan un corte real del proceso.
- Cómo: Crear pruebas con procesos aislados y puntos de sincronización para cortar antes y después de guardar o confirmar un envío. Lo difícil es hacerlas deterministas en ambos sistemas.

**I089 · Cubrir dependencias entre app y carcasa** (medio, no cambia lo que se ve)
- Qué: Que el chequeo rápido incluya las pruebas de Windows afectadas por un cambio compartido.
- Por qué: `app/scripts/check-changed.mjs:123` activa la suite de Windows si cambió `windows/` o corresponde una corrida completa. Un cambio compartido en `app/` no la activa por esa regla.
- Cómo: Declarar dependencias de contratos, archivos generados y reglas duplicadas para seleccionar sus pruebas. Lo difícil es mantener esa relación completa sin convertir cada chequeo en toda la suite.

**I090 · Retirar el respaldo congelado de producción** (grande, cambia lo que se ve)
- Qué: Que una instalación use siempre el motor vigente y explique claramente si falta.
- Por qué: `motor/bin/pa` todavía cae al bash si falta el compilado o recibe código 70; `motor/bin/reparto` conserva el respaldo Python. `cli/base/lock.ts` usa candados distintos de los originales.
- Cómo: Dejar los originales congelados para comparación, instalar lanzadores directos al TS y completar la cobertura antes de retirar la caída automática. Lo difícil es actualizar instalaciones existentes y conservar compatibilidad de estado.

### Salidas de esta noche

**I091 · Tope de workers vivos según el cupo** (medio, cambia lo que se ve)
- Qué: Trama calcula cuántos workers aguanta cada suscripción ahora y deja el resto en cola, en vez de arrancar todos y que mueran a mitad.
- Por qué: veinte corridas pesadas contra una ventana con lugar para pocas terminaron todas sin commits. El cupo se mira al lanzar, no lo que ya corre contra esa ventana.
- Cómo: medir el gasto típico por tipo × modelo × esfuerzo (ya está `pa --rinde`) y admitir workers mientras la suma proyectada entre en la ventana. Lo difícil es estimar bien una corrida que recién empieza.

**I092 · Gastar primero lo que se renueva antes** (medio, no cambia lo que se ve)
- Qué: al elegir motor para una tanda, preferir la suscripción cuya ventana vence antes y tiene cupo sin usar.
- Por qué: cupo que se renueva sin haberse usado es plata perdida; hoy el reparto mira calidad y cupo libre, no cuándo vence.
- Cómo: sumar al puntaje de `reparto` un término por «cupo libre × cercanía del reinicio», configurable en Ajustes y apagable.

**I093 · Cuántas corridas quedan, no sólo el porcentaje** (chico, cambia lo que se ve)
- Qué: el panel de cupos dice «quedan unas 6 corridas largas de este modelo» junto al porcentaje.
- Por qué: 30 % libre no dice nada si no se sabe cuánto gasta una corrida; hay que haberlo medido a mano.
- Cómo: con el historial de corridas por modelo, dividir el cupo libre por la mediana gastada. Decir «sin datos todavía» cuando no hay historial.

**I094 · Corridas en serie sobre los mismos archivos** (medio, no cambia lo que se ve)
- Qué: poder encadenar workers («este arranca cuando se integre aquel») para listas largas de arreglos en una misma área.
- Por qué: dos workers sobre los mismos archivos chocan al integrar, y uno solo se queda sin turnos antes de terminar la lista.
- Cómo: `pa --despues-de <id>` que espera a que el anterior esté integrado y parte del main nuevo. Lo difícil es qué hacer si el anterior falla.

**I095 · «Auditar un área» de punta a punta** (grande, cambia lo que se ve)
- Qué: un botón que lanza la auditoría de sólo lectura, muestra los hallazgos y deja elegir cuáles mandar a arreglar.
- Por qué: hoy ese flujo se arma a mano con briefs, y los hallazgos quedan en texto suelto.
- Cómo: guardar los hallazgos con formato fijo (id, severidad, dónde, arreglo) y generar el brief de arreglos con los elegidos. Reusa el revisor de planes para la segunda opinión.

**I096 · Integrar con el chequeo incluido** (chico, no cambia lo que se ve)
- Qué: `pa --integrar` corre el chequeo rápido en la rama antes de integrar y muestra el resumen del diff.
- Por qué: revisar e integrar son hoy tres comandos por rama; con diez ramas se saltea alguno.
- Cómo: una opción `--con-chequeo` que corre `check:changed` en el worktree y frena si no sale verde.

**I097 · Avisos de workers agrupados por causa** (medio, cambia lo que se ve)
- Qué: treinta avisos de workers caídos se muestran como «18 sin cupo en tal suscripción, 2 sin información», con un toque para ver cada uno.
- Por qué: una tanda que muere por la misma causa llena el chat y la campana de avisos iguales.
- Cómo: agrupar en la ventana por causa y por tanda; el aviso al líder llega resumido con los ids.

**I098 · Mensajes programados con condición** (chico, cambia lo que se ve)
- Qué: un mensaje programado puede decir «sólo si el chat está parado» o «sólo si volvió el cupo de tal suscripción».
- Por qué: los respaldos por hora llegan igual cuando el líder está trabajando y le gastan un turno para decir «seguí».
- Cómo: condiciones simples evaluadas por el proceso principal antes de encolar; si no se cumple, se saltea y queda anotado.

**I099 · El aviso de privacidad dice qué línea lo disparó** (chico, cambia lo que se ve)
- Qué: cuando un brief no puede salir a otro motor, el aviso muestra la línea y el motivo, y deja elegir entre corregir, mandarlo igual a Claude o no lanzar.
- Por qué: hoy cambia de motor solo y el aviso se pierde en la salida de error; se gasta el cupo que se quería cuidar.
- Cómo: `secretoEn` y `afueraEn` ya devuelven el motivo: falta llevarlo con la línea hasta el aviso y sumar el modo estricto.

**I100 · Costo estimado antes de lanzar** (medio, cambia lo que se ve)
- Qué: antes de lanzar un worker, mostrar cuánto de la ventana va a gastar según corridas parecidas.
- Por qué: se elige modelo y esfuerzo a ciegas; el costo se ve recién cuando se acabó el cupo.
- Cómo: mediana por tipo × modelo × esfuerzo del historial, en porcentaje de ventana. En el selector de modelos y en la confirmación de `lanzar_worker`.

**I101 · Usar el `pa` del repo mientras se desarrolla** (chico, no cambia lo que se ve)
- Qué: un interruptor de desarrollo para que los workers de este proyecto corran con el CLI compilado del repo y no con el instalado.
- Por qué: un arreglo del propio `pa` no sirve para la tanda en curso hasta publicar una versión.
- Cómo: una variable de entorno o una clave de Ajustes que apunte al `dist-electron` del repo, con un aviso visible mientras esté prendida.

**I102 · Tablero de una tanda** (medio, cambia lo que se ve)
- Qué: una vista de la tanda nocturna: qué informes llegaron, qué arreglos corren, qué falta integrar y cuánto cupo queda por suscripción.
- Por qué: hoy eso se arma con un script aparte y un archivo de texto.
- Cómo: agrupar los workers por tanda (una etiqueta al lanzar) y dibujar la tabla en el panel del líder; reusa `pa --hilos`.

