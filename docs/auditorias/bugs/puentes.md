# Auditoría de bugs — Puentes a otros motores

Revisión estática completa (3191 líneas) y reproducción puntual en Node sobre los ocho archivos del área:
- `app/electron/agy-puente.ts` (682 líneas)
- `app/electron/codex-puente.ts` (424 líneas)
- `app/electron/codex-stream.ts` (261 líneas)
- `app/electron/dsh-ajustes.ts` (154 líneas)
- `app/electron/dsh-puente.ts` (861 líneas)
- `app/electron/acp.ts` (339 líneas)
- `app/electron/contexto-local.ts` (274 líneas)
- `app/electron/resumen-traspaso.ts` (196 líneas)

Resumen: **20 bugs** (**7 alta**, **8 media**, **5 baja**), ordenados por severidad.

---

## Severidad alta

### PUENTES-1 · ChatGPT (`codex.cmd`) falla antes de arrancar en Windows por comillas en `argsCodex`
- **Severidad:** alta  ·  **Confianza:** alta
- **Dónde:** `app/electron/codex-stream.ts` líneas 249-252 (`argsCodex`) y `app/electron/codex-puente.ts` líneas 226-228 (`correrCodex`)
- **Qué pasa:** Si en Windows `codex` está instalado vía npm (`codex.cmd`), cualquier turno de un líder de ChatGPT falla antes de lanzar el subproceso con el error `argumento no apto para cmd.exe: "model_reasoning_effort=\"medium\""`.
- **Por qué:** `argsCodex` arma dos argumentos `-c` con comillas dobles literales:
  ```ts
  "-c",
  `model_reasoning_effort="${x.effort}"`,
  "-c",
  'approval_policy="never"',
  ```
  `codex-puente.ts` le pasa ese array a `paraLanzar(CODEX, args, ENTORNO)` (`app/electron/binario.ts:306-309`). Cuando el binario termina en `.cmd`, `paraLanzar` llama a `argParaCmd(a)` (`app/electron/binario.ts:280-283`), que hace:
  ```ts
  if (/["%\r\n]/.test(a)) throw new Error(`argumento no apto para cmd.exe: ${JSON.stringify(a.slice(0, 40))}`);
  ```
  Como la función lanza antes de armar la promesa o hacer `spawn`, `correrCodex` rechaza de forma síncrona en cada mensaje (pasa lo mismo en `app/electron/revision-plan.ts:313-315` al llamar a `argsCodex` con `paraLanzar`). En Linux no falla porque `paraLanzar` no pasa por `argParaCmd`, y en Windows sólo zafa si se usa un `.exe` nativo.
- **Cómo reproducir:** Correr desde `app/`:
  ```bash
  node --experimental-strip-types -e '
  import { argsCodex } from "./electron/codex-stream.ts";
  import { paraLanzar } from "./electron/binario.ts";
  const args = argsCodex({ modelo: "gpt-5.4", effort: "medium", sandbox: "danger-full-access", cwd: "C:\\proj", imagenes: [], thread: null });
  paraLanzar("C:\\Users\\ana\\AppData\\Roaming\\npm\\codex.cmd", args, {}, "win32");
  '
  ```
  Salida observada: lanza `Error: argumento no apto para cmd.exe: "model_reasoning_effort=\"medium\""`.
- **Arreglo propuesto:** En `codex-stream.ts:250,252`, quitar las comillas TOML innecesarias o resolverlas según bandera nativa (`--ask-for-approval never` en lugar de `-c approval_policy="never"` y verificar si `codex exec` acepta `model_reasoning_effort=medium` sin comillas —en TOML/CLI un enum simple suele pedirse con comillas, por lo que para Windows conviene pasar esos `-c` sin `"` si `codex` los acepta o usar flags CLI equivalentes / env/config temporal, evitando comillas dobles en `argv`). Agregar un test unitario en `app/tests/codex-windows.test.ts` que llame a `paraLanzar("C:\\...\\codex.cmd", argsCodex(...), {}, "win32")` y verifique que no tire.
- **Archivos que tocaría el arreglo:** `app/electron/codex-stream.ts`, `app/tests/codex-windows.test.ts`.

---

### PUENTES-2 · El medidor de contexto de ChatGPT queda siempre en 0 tokens
- **Severidad:** alta  ·  **Confianza:** alta
- **Dónde:** `app/electron/codex-stream.ts` líneas 106-108, 139-147, 199-203 (`Traductor`) y `app/electron/codex-puente.ts` líneas 313, 319 (`turno`)
- **Qué pasa:** El anillo/medidor de uso de contexto de un líder de ChatGPT marca `0` en vivo durante el turno y también al recargar el transcript desde disco, aunque `turn.completed` sí devuelva `input_tokens`.
- **Por qué:** Tres causas combinadas:
  1. En `codex-stream.ts:141`, cuando llega `item.completed` de tipo `agent_message`, `Traductor` emite `message_start` con `usage: { input_tokens: this.contexto, output_tokens: 0 }`. En `codex exec --json`, `agent_message` llega **antes** que `turn.completed`, por lo que `this.contexto` todavía vale `0` en el primer mensaje.
  2. `Traductor.mensaje()` (`codex-stream.ts:106-108`) construye el objeto `{ type: "assistant", message: { id, role: "assistant", model: this.o.modelo, content } }` **sin campo `usage`**, a diferencia de `agy-stream.ts:150` y `dsh-puente.ts:316`. Como `codex-puente.ts` sólo graba al `.jsonl` los eventos `assistant` y `tool_result` (`292`), el transcript queda sin tokens guardados y al reabrir el hilo el parser lee `0`.
  3. `Traductor` de `codex-stream.ts` no recibe `contextoPrevio`, y `codex-puente.ts:313,319` instancia `new Traductor({ sid, modelo })` ignorando `lado.contexto` leído de `LADO` (pese a que la línea 322 sí guarda `ultimo.contexto` en disco). Además `lider-arma.ts:818-824` no actualiza el medidor de contexto con el `usage` del evento `result`.
- **Cómo reproducir:** Correr desde `app/`:
  ```bash
  node --experimental-strip-types -e '
  import { Traductor } from "./electron/codex-stream.ts";
  const tr = new Traductor({ sid: "s1", modelo: "gpt-5.4" });
  console.log(JSON.stringify(tr.linea({ type: "item.completed", item: { id: "i1", type: "agent_message", text: "Hola" } })));
  console.log(JSON.stringify(tr.linea({ type: "turn.completed", usage: { input_tokens: 15000, output_tokens: 200, reasoning_output_tokens: 50 } })));
  '
  ```
  Salida observada: `message_start` sale con `"input_tokens":0` y el evento `assistant` sale sin propiedad `"usage"`.
- **Arreglo propuesto:**
  1. Pasar `contextoPrevio?: number | null` en `codex-stream.ts` (`Opciones` de `Traductor`) y enviarlo desde `codex-puente.ts:313` (`leerLado().contexto`).
  2. Emitir un `message_start` / `assistant` sintético o actualizar el `usage` del último `assistant` / `message_start` cuando llega `turn.completed` (o que `lider-arma.ts` lea también `usage.input_tokens` de `result` para actualizar la lectura de contexto del turno cuando no llegó en `assistant`). Agregar un test en `app/tests/codex-stream.test.ts` y `app/tests/lider-codex.test.ts` verificando `contexto` > 0 al terminar y tras recargar.
- **Archivos que tocaría el arreglo:** `app/electron/codex-stream.ts`, `app/electron/codex-puente.ts`, `app/electron/lider-arma.ts`, `app/tests/codex-stream.test.ts`, `app/tests/lider-codex.test.ts`.

---

### PUENTES-3 · «Mandar ya» nunca funciona en ChatGPT: falta `trama_directo`, eco perdido y errores en imagen sola
- **Severidad:** alta  ·  **Confianza:** alta
- **Dónde:** `app/electron/codex-puente.ts` líneas 181, 307, 417-418 (`mensajeDeUsuario`, `turno`, lector de stdin) en conjunto con `app/electron/lider.ts` línea 1426 (`mandarDirecto`)
- **Qué pasa:** Cuando el usuario manda un mensaje con «Mandar ya» a un líder de ChatGPT ocupado, el mensaje queda atrapado en la espera de gracia de `cola.ts` (4 s sin confirmación de eco) y en `p.directos` de `lider.ts` aunque sí haya entrado después al turno siguiente; si el «Mandar ya» llevaba sólo una imagen sin texto, `codex-puente.ts` anota `content: ""` en el transcript y nunca se confirma su entrega.
- **Por qué:** `codex-puente.ts` está preparado para recibir `trama_directo: true` (`181: const directo = o?.trama_directo === true`) y devolver el eco `isReplay: true` que `lider.ts` espera (`307: if (m.directo) eco(m.texto); // llegó a mitad de otro turno: entra ahora, y lider.ts espera su eco`). Sin embargo:
  1. En `app/electron/lider.ts:1426`, `mandarDirecto` escribe:
     ```ts
     p.p.stdin!.write(lineaUsuario(texto, imagenes, p.clase === "gemini" || p.clase === "dsh" || p.clase === "opencode"));
     ```
     Falta `|| p.clase === "codex"`. Al mandar `trama_directo: false`, `m.directo` en `codex-puente.ts` siempre da `false` y nunca emite `eco(m.texto)`, mientras `lider.ts:1424` ya agregó el texto a `p.directos`.
  2. Además, si `m.directo` fuera `true` con `ocupado === true`, el lector de stdin en `codex-puente.ts:417-418` lo mete en `cola.push(m)` al final detrás de mensajes encolados comunes (a diferencia de `directos` que salen primero en `agy-puente.ts:545` y `dsh-puente.ts:793`).
- **Cómo reproducir:** Con un líder de `codex:` corriendo un turno largo, llamar a `mandarDirecto` desde la app; observar en el stream de stdout de `codex-puente` que nunca aparece `{ type: "user", isReplay: true }` al iniciar el turno con ese mensaje, y `p.directos` en `lider.ts` no recibe `entregado` por eco directo.
- **Arreglo propuesto:** Agregar `|| p.clase === "codex"` en `app/electron/lider.ts:1426` y separar en `codex-puente.ts` una cola prioritaria `directos` (como en `agy-puente.ts`/`dsh-puente.ts`, si `codex exec` no se interrumpe a mitad de turno, al menos que salga antes que `cola` con su `eco`). Cubrir en `app/tests/lider-codex.test.ts` enviando un mensaje con `mandarDirecto` durante un turno en curso.
- **Archivos que tocaría el arreglo:** `app/electron/lider.ts`, `app/electron/codex-puente.ts`, `app/tests/lider-codex.test.ts`.

---

### PUENTES-4 · Al parar a Gemini o caerse `agy` a mitad de turno, las herramientas quedan abiertas y el texto parcial se pierde
- **Severidad:** alta  ·  **Confianza:** alta
- **Dónde:** `app/electron/agy-puente.ts` líneas 370-378 (`correrAgy`) y `app/electron/agy-stream.ts` líneas 287-301 (`Traductor.fin`)
- **Qué pasa:** Si la persona toca «Parar» (`interrumpido = true`) o el proceso `agy` sale con error/código distinto de cero mientras hay una herramienta ejecutándose o texto parcial acumulado en un `agent_response` todavía en estado `RUNNING`, el turno termina emitiendo `result` sin cerrar la herramienta con `tool_result` ni volcar el texto acumulado. Al recargar la conversación desde el `.jsonl`, la herramienta queda girando para siempre en estado pendiente.
- **Por qué:** En `agy-puente.ts:361-369`, los cortes por `v.corte` y `v.bucle` llaman explícitamente a `tr.cerrarAbiertas(...)`. Pero al llegar a las líneas 375-378 (cuando fue interrumpido por la persona o terminó con error), sólo ejecuta:
  ```ts
  for (const o of tr.fin(error)) escribir(o);
  ```
  Y en `agy-stream.ts:287-301`, `Traductor.fin(error)` **no** llama a `this.cerrarAbiertas(...)` (a diferencia de `codex-stream.ts:215` y `dsh-puente.ts:387`) y tampoco vacía `this.texto` (que sólo se convierte en un bloque `assistant` al recibir `state === "DONE"` en `agy-stream.ts:201`).
- **Cómo reproducir:** Correr desde `app/`:
  ```bash
  node --experimental-strip-types -e '
  import { Traductor } from "./electron/agy-stream.ts";
  const t = new Traductor({ sid: "s1", modelo: "gemini-2.5-pro" });
  t.linea({ event: "init", conversation_id: "g1" });
  t.linea({ event: "step_update", step_update: { step_index: 1, step_type: "tool", state: "PENDING", tool_name: "run_command", tool_info: { parameters: { CommandLine: "sleep 10" } } } });
  t.linea({ event: "step_update", step_update: { step_index: 2, step_type: "agent_response", state: "RUNNING", text_delta: "Texto parcial" } });
  console.log(JSON.stringify(t.fin(null)));
  '
  ```
  Salida observada: devuelve únicamente `[{"type":"result","subtype":"success",...}]`, sin ningún `tool_result` ni mensaje `assistant` con `"Texto parcial"`.
- **Arreglo propuesto:** En `Traductor.fin(error)` (`app/electron/agy-stream.ts:287-301`), antes del `result`, volcar cualquier entrada pendiente en `this.texto` (emitir `content_block_stop`, `assistant` y `message_stop`) y anteponer `...this.cerrarAbiertas(error ?? "Interrumpido antes de que terminara este paso.")`. Cubrir en `app/tests/agy-directo.test.ts` o `app/tests/lider-gemini.test.ts` cortando un turno en medio de una herramienta abierta.
- **Archivos que tocaría el arreglo:** `app/electron/agy-stream.ts`, `app/tests/lider-gemini.test.ts`.

---

### PUENTES-5 · Un «Mandar ya» en `dsh`/`opencode` tras reiniciarse la sesión manda el mensaje sin prefacio ni historial
- **Severidad:** alta  ·  **Confianza:** alta
- **Dónde:** `app/electron/dsh-puente.ts` líneas 748-754 (`turno`)
- **Qué pasa:** Si un «Mandar ya» (`corte`) interrumpe un prompt de `dsh` u `opencode`, el proceso ACP muere (por el timeout `MS_CANCELAR` o por fallo del servidor al cancelar), y al relanzarlo `levantar()` no puede hacer `session/resume` y abre una sesión nueva, el mensaje directo se manda pelado, sin `PROMPT_DSH`/`PROMPT_OPENCODE`, sin los `CLAUDE.md`/`AGENTS.md`, sin el aviso de `pa` y sin el historial `hablado()`. Además `faltaPrefacio` queda en `true` y se inyecta recién en el turno siguiente (demasiado tarde).
- **Por qué:** En `dsh-puente.ts:748-754`:
  ```ts
  if (corte && !interrumpido) {
    for (const o of tr.cerrarAbiertas("El mensaje que mandaste a mitad del turno cortó este paso.")) salida(o);
    corte = false;
    if (cliente && !cliente.activo) await asegurar();
    enviado = plegar(null, []); // dsh guarda el mensaje cortado: el nuevo va solo
    continue;
  }
  ```
  Cuando `!cliente.activo`, `await asegurar()` llama a `levantar()`, que si abre una sesión nueva pone `faltaPrefacio = true` (`607`). Pero la línea 752 nunca revisa `faltaPrefacio`: asigna `enviado = plegar(null, [])` en crudo, a diferencia del arranque del turno (`736-737`). Note también que si `cliente === null` (porque `salio` ocurrió y otro código lo limpió), `if (cliente && !cliente.activo)` ni siquiera llama a `asegurar()` y `correrPrompt` en `744` falla con `cliente!.prompt` null-dereference.
- **Cómo reproducir:** Iniciar un turno de `dsh`/`opencode` con sesión volátil (que falle `session/resume`), mandar un «Mandar ya» que dispare el timeout `MS_CANCELAR` (matando al hijo) y observar el siguiente `session/prompt` que envía `dsh-puente`: sólo contiene `[Mensaje ... a mitad del turno...]` sin `prefacio` ni `hablado()`.
- **Arreglo propuesto:** En `dsh-puente.ts:751-752`, llamar `await asegurar()` siempre que `!cliente?.activo || !acpSid`, armar `const p = plegar(null, [])`, y si `faltaPrefacio` quedó en `true`, envolver `p.texto = conPrefacio(p.texto, hablado())` (o `previo`) y resetear `faltaPrefacio = false`. Agregar test en `app/tests/dsh-puente.test.ts`.
- **Archivos que tocaría el arreglo:** `app/electron/dsh-puente.ts`, `app/tests/dsh-puente.test.ts`.

---

### PUENTES-6 · Errores de cuota de OpenCode quedan colgados 3 minutos o sin detectar si llegan partidos, tras pensar o en `error.data`
- **Severidad:** alta  ·  **Confianza:** alta
- **Dónde:** `app/electron/dsh-puente.ts` líneas 565-572, 625-638 (`levantar`, `textoDeError`)
- **Qué pasa:** Cuando OpenCode falla por límite gratis (`Free usage limit exceeded`) o `AI_RetryError`/`AI_APICallError` 429, el corte inmediato puede fallar y dejar al usuario esperando 180 s (`MS_SIN_EVENTOS`), o mostrar un error genérico sin marcar agotada la cuenta/modelo ni orientar al usuario.
- **Por qué:** Hay tres puntos frágiles en `dsh-puente.ts`:
  1. En `alActualizar` (`565-567`), si OpenCode emite primero un chunk de pensamiento (`agent_thought_chunk`), o si el mensaje de error viene partido en dos `agent_message_chunk` (p. ej. `"AI_APICallError: "` y luego `"Free usage limit..."`), la primera pasada no coincide con `esErrorDeServidorOpencode(dicho)` y ejecuta `actual.actualizacion(u)`, lo que marca `this.hablo = true` (`260`). Desde ese chunk en adelante `!actual.hablo` es `false`, así que el error del chunk siguiente nunca activa `cortarPorErrorDelServidor` y `session/prompt` queda colgado 3 minutos.
  2. En `alStderr` (`571`), se evalúa `esErrorDeServidorOpencode(t)` sobre el fragmento crudo `t` del evento `data`, no sobre `c.stderr` acumulado: si el stream parte la línea entre `"AI_APICallError"` y `"quota"`/`"limit"`, la regex falla.
  3. En `textoDeError(e)` (`625-638`), la detección de cuota pasa únicamente `${String((e as Error)?.message ?? e)}\n${err}`, sin incluir `(e as ErrorAcp).data`. Si el servidor ACP devuelve el detalle de cuota/429 dentro de `error.data` sin repetirlo en `stderr`, no dispara `marcarOpencodeAgotado` ni `marcarModeloGoAgotado` ni devuelve `opencodeSinCupo`/`opencodeGoSinCupo`.
- **Cómo reproducir:** Simular con `opencode-acp-falso.mjs` un servidor que envíe un `agent_thought_chunk` seguido de `"Free usage limit exceeded"` en `agent_message_chunk` sin cerrar `session/prompt`, o que mande `AI_APICallError: 429` partido en dos chunks por stderr: no corta de inmediato sino que espera `MS_SIN_EVENTOS`. Y si responde un JSON-RPC error con `code: -32000`, `message: "Provider error"`, `data: "Free usage limit"`, `textoDeError` no lo detecta como cuota.
- **Arreglo propuesto:** Acumular el principio del texto del turno (sin cancelar la detección por chunks previos si aún no cerró herramienta/respuesta o acumulando los últimos N chars de `agent_message_chunk` iniciales cuando no hubo herramienta), evaluar `esErrorDeServidorOpencode(c.stderr)` sobre el buffer acumulado en `alStderr`, e incluir `e instanceof ErrorAcp && e.data ? JSON.stringify(e.data) : ""` en el texto evaluado por `textoDeError`. Cubrir en `app/tests/lider-opencode-colgado.test.ts` y `app/tests/opencode-puente.test.ts`.
- **Archivos que tocaría el arreglo:** `app/electron/dsh-puente.ts`, `app/tests/lider-opencode-colgado.test.ts`, `app/tests/opencode-puente.test.ts`.

---

### PUENTES-7 · Cualquier error previo al primer paso borra la conversación guardada de Gemini/ChatGPT y reintenta desde cero
- **Severidad:** alta  ·  **Confianza:** alta
- **Dónde:** `app/electron/agy-puente.ts` líneas 370-374, 499-503 (`correrAgy`, `turno`) y `app/electron/codex-puente.ts` líneas 274-278, 317-321 (`correrCodex`, `turno`)
- **Qué pasa:** Si al retomar una conversación existente el primer turno falla antes de completar un paso (`v.pasos === 0`) por **cualquier** motivo —binario ausente (`ENOENT`), corte de red, sesión vencida/login caído, límite de cuota o modelo inválido— ambos puentes asumen que «no existía la conversación», tiran el ID real (`conversation_id` / `thread_id`), relanzan todo el proceso desde cero con un resumen de texto recortado a 12 KB (`hablado()`), y si el segundo intento llega a generar un ID nuevo, sobrescriben el archivo `.json` perdiendo para siempre la sesión original y los resultados de comandos previos.
- **Por qué:** Tanto `agy-puente.ts:371` como `codex-puente.ts:275` hacen:
  ```ts
  const mal = motivo !== null || !!codigo;
  if (v.conversacion && !v.pasos && (mal || v.sinConversacion) && !interrumpido) {
    v.sinConversacion = true;
    return ok(v);
  }
  ```
  Todo error técnico (`motivo !== null`, que incluso incluye errores de `spawn` como `ENOENT`) o código de salida distinto de `0` se convierte en `v.sinConversacion = true`, sin inspeccionar `stderr` ni distinguir «sesión no encontrada» de un fallo de red, autenticación o binario ausente (en contraste con `dsh-puente.ts:587-588`, que sólo reinicia la sesión ante `ErrorAcp` de `session/resume`). Además, en `agy-puente.ts:499-503`, si se estaba corriendo `/compact`, el reintento con sesión nueva reenvía `/compact` contra una conversación vacía en vez de avisar o preservar la sesión.
- **Cómo reproducir:** Con un `.json` que tenga un `conversation_id` / `thread_id` guardado, hacer que `HILOS_AGY` o `HILOS_CODEX` apunte a un binario inexistente (`ENOENT`) o a un script que salga con código `1` y stderr `"network timeout"`: el puente lanza el proceso **dos veces** seguidas y la segunda ya sale sin `--conversation` / `resume`, enviando el `prefacio + hablado()`.
- **Arreglo propuesto:** No tratar `motivo !== null` (error de `spawn`) ni errores genéricos de red/auth/cuota como `v.sinConversacion`: inspeccionar `stderr` o el mensaje de `result`/`error` para disparar la recuperación con sesión nueva **solo** cuando el CLI indique que la conversación/hilo no existe o no se pudo cargar, propagando los demás errores sin borrar `LADO`. Agregar tests en `app/tests/lider-gemini.test.ts` y `app/tests/lider-codex.test.ts`.
- **Archivos que tocaría el arreglo:** `app/electron/agy-puente.ts`, `app/electron/codex-puente.ts`, `app/tests/lider-gemini.test.ts`, `app/tests/lider-codex.test.ts`.

---

## Severidad media

### PUENTES-8 · `politicaEnWorkspace` aprueba rutas fuera de la carpeta si vienen en `toolCall.rawInput`, `tool_call_update` o como `filepath`/`filePath`
- **Severidad:** media  ·  **Confianza:** alta
- **Dónde:** `app/electron/acp.ts` líneas 104-116, 314, 330 (`politicaEnWorkspace`, `ClienteAcp.notificacion`, `ClienteAcp.pedidoDelAgente`)
- **Qué pasa:** La política por defecto de `ClienteAcp` (`politicaEnWorkspace(raiz)`) deja pasar (`"permitir"`) pedidos de permiso que apuntan a archivos o directorios fuera de `raiz`, o que piden `danger-full-access`, en tres casos reales.
- **Por qué:**
  1. `ClienteAcp.notificacion` (`acp.ts:314`) únicamente guarda `u.rawInput` en `this.llamadas` cuando `u.sessionUpdate === "tool_call"`, ignorando los `tool_call_update` (justamente donde agentes como OpenCode completan `rawInput`, según documenta `dsh-puente.ts:325-327`).
  2. `ClienteAcp.pedidoDelAgente` (`acp.ts:330`) pasa `entrada: this.llamadas.get(String(toolCall.toolCallId)) ?? null`, sin usar `toolCall.rawInput` como respaldo si vino directamente en `session/request_permission`. Y la línea 111 hace `if (!entrada) return "permitir";`.
  3. La línea 113 sólo revisa `["file_path", "path", "cwd"]`, dejando afuera `filepath` y `filePath` (variantes que `dsh-puente.ts:189` sí reconoce porque los agentes ACP las usan).
- **Cómo reproducir:** Correr desde `app/`:
  ```bash
  node --experimental-strip-types -e '
  import { politicaEnWorkspace } from "./electron/acp.ts";
  import path from "node:path";
  const pol = politicaEnWorkspace(path.resolve("caja/repo"));
  const fuera = path.resolve("caja/afuera/secreto.txt");
  console.log("rawInput solo en toolCall:", pol({ sessionId: "s", entrada: null, toolCall: { toolCallId: "t1", rawInput: { file_path: fuera } }, opciones: [] }));
  console.log("entrada.filepath:", pol({ sessionId: "s", entrada: { filepath: fuera }, toolCall: {}, opciones: [] }));
  '
  ```
  Salida observada en ambos casos: `permitir`.
- **Arreglo propuesto:** En `acp.ts:314`, actualizar también `this.llamadas` ante `tool_call_update` que traiga `rawInput` (mezclando con el previo). En `acp.ts:330`, usar `this.llamadas.get(id) ?? (toolCall.rawInput && typeof toolCall.rawInput === "object" ? toolCall.rawInput : null)`. En `politicaEnWorkspace` (`113`), revisar también `filePath` y `filepath` (y en lo posible rechazar ante `entrada === null` si `toolCall.locations` apunta fuera). Sumar tests en `app/tests/acp.test.ts`.
- **Archivos que tocaría el arreglo:** `app/electron/acp.ts`, `app/tests/acp.test.ts`.

---

### PUENTES-9 · Al desencolar mensajes entre turnos, ninguno de los tres puentes emite `status: "requesting"`
- **Severidad:** media  ·  **Confianza:** alta
- **Dónde:** `app/electron/agy-puente.ts` líneas 539-549, `app/electron/dsh-puente.ts` líneas 788-797, `app/electron/codex-puente.ts` líneas 343-349 (`cerrarTurno`, junto con `app/electron/lider.ts` líneas 747-749, 780-784)
- **Qué pasa:** Cuando un mensaje estaba esperando en la cola interna del puente (o quedó un «Mandar ya» sin entrar en `directos` al cerrarse el turno anterior), el puente termina el turno con `result`, `lider.ts` pone al líder como libre (`x.ocupado = false`), e inmediatamente el puente arranca el turno siguiente en `cerrarTurno()`, pero la interfaz y `lider.ts` creen que el líder está en reposo (`ocupado: false`) hasta que el nuevo turno termine o se cierre.
- **Por qué:** En `lider.ts:747-749`, el evento `fin` (`result`) marca `x.ocupado = false` y avisa `{ tipo: "estado", ocupado: false }`. El comentario de `lider.ts:778-784` explica que los turnos que arrancan sin pasar por `mandar()` dependen de recibir `e.tipo === "hace" && e.hace.que === "pidiendo"`, lo que viene únicamente de `{ type: "system", subtype: "status", status: "requesting" }` (`lider-arma.ts:645`). Ninguno de los tres puentes emite `status: "requesting"` al iniciar `turno()` o desencolar `siguiente` en `cerrarTurno()`.
- **Cómo reproducir:** Encolar dos mensajes rápidos a un líder de Gemini, ChatGPT o dsh/OpenCode de modo que el segundo quede en `cola` del puente (p. ej. mandando dos líneas `user` por stdin mientras corre el turno 1): al emitirse el primer `result`, `x.ocupado` pasa a `false` y el evento siguiente hasta que el segundo turno conteste herramientas no emite ningún `status: "requesting"`.
- **Arreglo propuesto:** Emitir `{ type: "system", subtype: "status", status: "requesting", parent_tool_use_id: null, session_id: sid }` al desencolar un mensaje en `cerrarTurno()` (o al entrar a `turno()`) en `agy-puente.ts`, `dsh-puente.ts` y `codex-puente.ts`. Cubrir con test en `app/tests/lider-gemini.test.ts` / `dsh-puente.test.ts` / `lider-codex.test.ts`.
- **Archivos que tocaría el arreglo:** `app/electron/agy-puente.ts`, `app/electron/codex-puente.ts`, `app/electron/dsh-puente.ts`, tests de los tres puentes.

---

### PUENTES-10 · Al retomar en `dsh`/`opencode`, se mantiene el modelo viejo si `configOptions` omite `model` o `currentValue`
- **Severidad:** media  ·  **Confianza:** alta
- **Dónde:** `app/electron/dsh-puente.ts` líneas 598-600 (`levantar`)
- **Qué pasa:** Si el usuario cambia de modelo (o se relanza el puente con otro modelo sobre una sesión existente) y el agente ACP devuelve `configOptions: []` o una opción `model` sin `currentValue` (`undefined`) en `session/resume` o `session/new`, `dsh-puente` se saltea `session/set_config_option` y sigue ejecutando el modelo anterior en silencio, mientras la app etiqueta los mensajes con el modelo nuevo.
- **Por qué:** En `dsh-puente.ts:599-600`:
  ```ts
  const actualOpt = opciones.find((o) => o?.id === "model")?.currentValue;
  if (actualOpt !== undefined && actualOpt !== quiero) opciones = (await c.configurar(acpSid, "model", quiero)).configOptions;
  ```
  La condición exige `actualOpt !== undefined`. Si `configOptions` omitió `model` o no trajo `currentValue` en `session/resume`, `actualOpt` es `undefined` y nunca se llama a `c.configurar(acpSid, "model", quiero)`.
- **Cómo reproducir:** Hacer que `opencode-acp-falso.mjs` o un agente ACP responda `{ configOptions: [] }` en `session/resume` o `session/new` y verificar que `dsh-puente` nunca envía `session/set_config_option` para `configId: "model"`.
- **Arreglo propuesto:** Cuando `oc` está activo (donde el CLI se lanza siempre con `["acp"]` sin flag de modelo) o cuando `!nueva` (`session/resume`), si `actualOpt !== quiero`, intentar `c.configurar(acpSid, "model", quiero)` incluso si `actualOpt === undefined` (capturando sólo si el agente declara explícitamente no soportar la opción `model` en `dsh` con `--patch` donde ya fijó el modelo único). Agregar test en `app/tests/opencode-puente.test.ts`.
- **Archivos que tocaría el arreglo:** `app/electron/dsh-puente.ts`, `app/tests/opencode-puente.test.ts`.

---

### PUENTES-11 · Chunks ACP sin `messageId` crean un globo separado por cada pedazo de texto o pensamiento
- **Severidad:** media  ·  **Confianza:** alta
- **Dónde:** `app/electron/dsh-puente.ts` líneas 280-289 (`Traductor.trozo`)
- **Qué pasa:** Si un agente ACP emite `agent_message_chunk` o `agent_thought_chunk` sin campo `messageId` (que en ACP es opcional cuando un agente streamea token a token), cada chunk genera un mensaje `assistant` completo por separado y una burbuja nueva en el chat.
- **Por qué:** En `dsh-puente.ts:284-285`:
  ```ts
  const id = texto(u.messageId) ?? `m${++this.n}`;
  if (this.buf && this.buf.id !== id) out.push(...this.vaciar());
  ```
  Al omitir `messageId`, cada chunk recibe un `id` nuevo (`"m1"`, `"m2"`, `"m3"`…), haciendo falsa la igualdad `this.buf.id === id` y disparando `this.vaciar()` (que cierra el `message_stop` anterior y escribe un mensaje `assistant` nuevo al transcript) en cada token o fragmento.
- **Cómo reproducir:** Alimentar a un `dsh-puente` dos eventos `session/update` seguidos con `sessionUpdate: "agent_message_chunk"`, `content: { type: "text", text: "Ho" }` y `"la"`, sin `messageId`: emite dos eventos `assistant` y dos `message_stop` separados.
- **Arreglo propuesto:** Si `u.messageId` viene vacío (`null`), reutilizar `this.buf.id` cuando ya haya un buffer abierto del mismo mensaje (en vez de incrementar `this.n` en cada chunk) y recién asignar `m${++this.n}` cuando `this.buf` sea `null`, cerrando al llegar un `messageId` distinto, una herramienta o el fin de turno. Agregar test en `app/tests/dsh-puente.test.ts`.
- **Archivos que tocaría el arreglo:** `app/electron/dsh-puente.ts`, `app/tests/dsh-puente.test.ts`.

---

### PUENTES-12 · Desfase al parar (`PARAR_MS` 3 s vs `MS_CANCELAR` 10 s): `SIGINT` reinicia el corte en Linux y `taskkill` mata el puente en Windows
- **Severidad:** media  ·  **Confianza:** alta
- **Dónde:** `app/electron/dsh-puente.ts` líneas 674-681, 809-811, `app/electron/agy-puente.ts` líneas 552-558, 614-616 y `app/electron/codex-puente.ts` líneas 351-357, 372-374 (frente a `app/electron/lider.ts` líneas 123, 2314-2328 y `app/electron/procesos.ts` líneas 55-58)
- **Qué pasa:** Al apretar «Parar» en un turno que tarda en cancelarse (> 3 s):
  - En Windows, `lider.ts` mata a los 3 s (`PARAR_MS = 3000`) el proceso entero del puente (`dsh-puente`, `agy-puente` o `codex-puente`) con `taskkill /T /F`, sin darle tiempo a `dsh-puente` (que espera hasta 10 s con `MS_CANCELAR = 10000` antes de matar a `dsh`/`opencode`), sin emitir `result` ni cerrar herramientas abiertas en el transcript y dejando bloqueado el turno hasta el timeout o reinicio.
  - En Linux, `lider.ts` manda `SIGINT` al puente (`procesos.ts:57`) a los 3 s. El handler `process.on("SIGINT")` de los tres puentes (en vez de escalar a matar al hijo o salir) llama otra vez a `interrumpir()`: en `dsh-puente` eso reenvía `session/cancel` y **reinicia** el timer `MS_CANCELAR` a otros 10 s nuevos (`677-679`), y en `agy-puente`/`codex-puente` vuelve a enviar `SIGTERM` con un nuevo `setTimeout(..., 3000)` antes de `SIGKILL`.
- **Por qué:** Al recibir `control_request` `interrupt` por stdin (`dsh-puente.ts:841`, `agy-puente.ts:662`, `codex-puente.ts:403`), los puentes sí devuelven `control_response` enseguida, pero no terminan el turno hasta que el subproceso cierre (y `MS_CANCELAR` en `dsh-puente` es 10 s mientras `PARAR_MS` en `lider.ts` es 3 s). Al vencerse `PARAR_MS`, `lider.ts:2324` llama `interrumpir(pid)`: en Windows dispara `taskkill /T /F` directo sobre el puente; en Linux manda `SIGINT`, que cae en el mismo `interrumpir()` blando que acababa de fracasar 3 s antes.
- **Cómo reproducir:** En un test con `dsh-puente` o `opencode` cuya respuesta a `session/cancel` tarde 4 s (menos de `MS_CANCELAR = 10000`, más que `PARAR_MS = 3000`), llamar `lider.parar(sid)`: en Linux a los 3 s `lider` envía `SIGINT`, `cancelarPrompt()` reinicia su contador a 10 s adicionales; en Windows mata el proceso entero del puente antes de cerrar el turno en el `.jsonl`.
- **Arreglo propuesto:** Alinear los tiempos (`PARAR_MS` en `lider.ts` por clase o mayor al timeout interno del puente cuando el subproceso existe, o bajar `MS_CANCELAR` por debajo de `PARAR_MS` para que el puente mate primero al hijo y cierre el turno con `result`), y en el handler de `SIGINT` de los tres puentes escalar directamente al `SIGKILL`/`matar()` del subproceso hijo si ya estaba `interrumpido === true`. Cubrir con test en `app/tests/dsh-puente.test.ts` y `app/tests/lider-dsh.test.ts`.
- **Archivos que tocaría el arreglo:** `app/electron/dsh-puente.ts`, `app/electron/agy-puente.ts`, `app/electron/codex-puente.ts`, `app/electron/lider.ts`, `app/tests/lider-dsh.test.ts`.

---

### PUENTES-13 · `destrabar()` omite el lector de razonamiento (`pensamiento`) en los reintentos de Gemini
- **Severidad:** media  ·  **Confianza:** alta
- **Dónde:** `app/electron/agy-puente.ts` línea 589 (`destrabar`)
- **Qué pasa:** Cuando el vigilante detecta un bucle en Gemini y `destrabar()` lanza una vuelta nueva de `agy` con el aviso para destrabarlo, todos los bloques de razonamiento (`thinking` / `pensado`) de esa vuelta y de las siguientes del bucle dejan de aparecer tanto en la vista como en el transcript.
- **Por qué:** Todas las demás instancias de `Traductor` en `agy-puente.ts` (líneas 469, 490, 501 y 524) pasan `pensamiento: razonamiento` en las opciones del constructor, pero la línea 589 dentro de `destrabar()` construye:
  ```ts
  tr = new Traductor({ sid, modelo, contextoPrevio: leerLado().contexto });
  ```
  sin pasar `pensamiento: razonamiento`. Sin ese callback, `Traductor.pensar()` (`agy-stream.ts:223`) retorna `null` inmediatamente.
- **Cómo reproducir:** En `app/electron/agy-puente.ts`, disparar un bucle que entre en `destrabar()` con un `transcript_full.jsonl` que tenga `"thinking"` para los pasos del reintento: el `Traductor` creado en la línea 589 no lee `transcript_full.jsonl` y no emite ningún bloque `thinking`.
- **Arreglo propuesto:** Agregar `pensamiento: razonamiento` en la llamada de la línea 589 de `app/electron/agy-puente.ts`. Cubrir con un test en `app/tests/agy-directo.test.ts`.
- **Archivos que tocaría el arreglo:** `app/electron/agy-puente.ts`, `app/tests/agy-directo.test.ts`.

---

### PUENTES-14 · `resumen-traspaso.ts` ignora ramas descartadas por `parentUuid` y toma errores sintéticos de API como estado actual
- **Severidad:** media  ·  **Confianza:** alta
- **Dónde:** `app/electron/resumen-traspaso.ts` líneas 75-112, 120-134, 150 (`extraerDatos`, `secciones`)
- **Qué pasa:** Al usar «Seguir con otro modelo» sobre un transcript que tuvo rebobinados/ramas (con `parentUuid` apuntando a un ancestro anterior) o cuyo último turno terminó con un error sintético de API (por ejemplo `API Error: 529 Overloaded`):
  1. El resumen incluye archivos editados, commits y decisiones de la rama vieja que la persona ya había descartado al volver atrás.
  2. El texto del error sintético pisa `d.estado` (`ultimoTexto`) y borra `d.sigue`, diciéndole al modelo nuevo que el estado actual es `"API Error: 529 Overloaded"`.
  3. Además, la sección `Pedidos posteriores (los últimos)` (`línea 150`) invierte el orden cronológico (`d.pedidos.slice(-3).reverse()`) poniendo el pedido más reciente arriba de pedidos anteriores sin indicar cuál es el último.
- **Por qué:** `extraerDatos` recorre todas las líneas del archivo en orden secuencial filtrando únicamente `r.isSidechain`, sin reconstruir la cadena activa por `parentUuid` desde el último nodo vivo ni filtrar `r.isApiErrorMessage` o `r.message?.model === "<synthetic>"` en la línea 89.
- **Cómo reproducir:** Correr desde `app/`:
  ```bash
  node --experimental-strip-types -e '
  import { resumenTraspaso } from "./electron/resumen-traspaso.ts";
  const lineas = [
    { type: "user", uuid: "u1", message: { role: "user", content: "Arreglá login" } },
    { type: "assistant", uuid: "a1", parentUuid: "u1", message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: "rama-borrada.ts" } }, { type: "text", text: "Decisión: usar foo.ts" }] } },
    { type: "user", uuid: "u2", parentUuid: "u1", message: { role: "user", content: "En realidad arreglá logout" } },
    { type: "assistant", uuid: "a2", parentUuid: "u2", isApiErrorMessage: true, message: { role: "assistant", model: "<synthetic>", content: [{ type: "text", text: "API Error: 529 Overloaded" }] } }
  ].map((x) => JSON.stringify(x));
  console.log(resumenTraspaso(lineas, { pedido: "Seguí" }));
  '
  ```
  Salida observada: en `## Estado` imprime `API Error: 529 Overloaded`, en `## Decisiones ya tomadas` deja `Decisión: usar foo.ts`, y en `## Archivos que tocó` incluye `rama-borrada.ts`.
- **Arreglo propuesto:** Si las líneas tienen `uuid`/`parentUuid`, reconstruir la ruta desde la última entrada no sidechain hacia la raíz antes de extraer datos (dejando el recorrido lineal como respaldo cuando falten `uuid`); saltear registros con `isApiErrorMessage === true` o `message?.model === "<synthetic>"`; y mantener el orden cronológico natural de `d.pedidos.slice(-3)` (del más viejo al más nuevo). Agregar tests en `app/tests/resumen-traspaso.test.ts`.
- **Archivos que tocaría el arreglo:** `app/electron/resumen-traspaso.ts`, `app/tests/resumen-traspaso.test.ts`.

---

### PUENTES-15 · En `codex-puente.ts`, mensajes con sólo imágenes quedan vacíos en el transcript, rompen `hablado()` y silencian fallos al guardar
- **Severidad:** media  ·  **Confianza:** alta
- **Dónde:** `app/electron/codex-puente.ts` líneas 128-134, 151, 201-215, 312 (`guardarLado`, `hablado`, `guardarImagenes`, `turno`)
- **Qué pasa:** Cuando la persona envía un mensaje a ChatGPT compuesto sólo por imágenes (sin texto), o cuando falla la escritura de las imágenes en `DIR_IMAGENES`:
  1. La línea 312 anota en el transcript `{ type: "user", message: { role: "user", content: m.texto } }` sin dejar constancia de las imágenes (a diferencia de `agy-puente.ts:261,487` y `dsh-puente.ts:729`). En un reinicio o recarga, el turno del usuario desaparece por `content: ""`; y mientras está en el archivo, `hablado()` (`151`) empuja `"<Dueño>: "` vacío.
  2. `guardarImagenes(m)` (`201-215`) atrapa cualquier error en disco con `catch { /* sin imágenes: el texto sale igual */ }` y devuelve `rutas` incompletas/vacías sin avisar ni a `codex` ni al usuario (mientras `agy-puente.ts:263-265` sí incluye una nota aclaratoria en el prompt). Además `guardarLado` (`128-134`) escribe directo a `LADO` sin archivo temporal + `renameSync` (a diferencia de `agy-puente.ts:165` y `dsh-puente.ts:142`), exponiendo lecturas truncadas si otro proceso lee al mismo tiempo.
- **Cómo reproducir:** Enviar a `codex-puente` un `user` con un bloque `image` en `content` y sin bloque `text`, y leer el `.jsonl` generado en `$HILOS_STATE/codex/<sid>.jsonl` y la salida de `hablado()`.
- **Arreglo propuesto:** Incluir la nota `[N imagen(es) adjunta(s)]` en el `anotar` de la línea 312 cuando `imagenes.length > 0` (y avisar en el prompt / error si `guardarImagenes` falla al escribir en disco, retornando también si `rutas.length < m.imagenes.length`), y hacer atómico `guardarLado` con `.tmp` + `renameSync` (con respaldo directo para Windows como en `agy-puente.ts:165-173`). Agregar test en `app/tests/lider-codex.test.ts`.
- **Archivos que tocaría el arreglo:** `app/electron/codex-puente.ts`, `app/tests/lider-codex.test.ts`.

---

## Severidad baja

### PUENTES-16 · `describirError` oculta `error.data` y `stderr` en errores ACP que no tienen código `-32603`
- **Severidad:** baja  ·  **Confianza:** alta
- **Dónde:** `app/electron/acp.ts` líneas 61-78 (`describirError`)
- **Qué pasa:** Cuando un agente ACP (`dsh` u `opencode`) responde un error JSON-RPC con código distinto de `-32603` (por ejemplo `-32000 "Server error"` o cualquier código de proveedor cuyo texto útil viene en `error.data` o en `stderr`), `describirError` ignora por completo `e.data` y `stderr` y devuelve sólo `"session/prompt: Server error"`, privando a la persona de la causa real.
- **Por qué:** La línea 64 condiciona el agregado de `e.data` y de `stderr` estrictamente a:
  ```ts
  if (e instanceof ErrorAcp && (e.code === -32603 || /internal error/i.test(base))) {
  ```
- **Cómo reproducir:** Correr desde `app/`:
  ```bash
  node --experimental-strip-types -e '
  import { describirError, ErrorAcp } from "./electron/acp.ts";
  console.log(describirError(new ErrorAcp("session/prompt", -32000, "Server error", "Free usage limit exceeded"), "detalle stderr\n", []));
  '
  ```
  Salida observada: `session/prompt: Server error` (omite `Free usage limit exceeded` y `detalle stderr`).
- **Arreglo propuesto:** Anexar `e.data` para cualquier `ErrorAcp` cuando no esté vacío y sea distinto de `base`, y anexar la cola de `stderr` cuando `e instanceof ErrorAcp` (o cuando un error genérico traiga `stderr` no reflejado en `base`). Cubrir en `app/tests/acp.test.ts`.
- **Archivos que tocaría el arreglo:** `app/electron/acp.ts`, `app/tests/acp.test.ts`.

---

### PUENTES-17 · Cierre brusco en `dsh-puente.ts` (no usa `cliente.cerrar()`) y `taskkill` asíncrono incompleto al salir en Windows
- **Severidad:** baja  ·  **Confianza:** alta
- **Dónde:** `app/electron/dsh-puente.ts` líneas 799-803, 813-817 (`terminar`, `exit`), `app/electron/agy-puente.ts` líneas 618-623 y `app/electron/codex-puente.ts` líneas 376-380
- **Qué pasa:**
  1. `dsh-puente.ts` nunca llama al método `cliente.cerrar()` que existe en `acp.ts:227-239`: al cerrarse `stdin` en reposo (`860`), llama directamente a `terminar(0)` que dispara `cliente?.matar()` (`SIGKILL` / `taskkill /F`) inmediatamente en lugar de cerrar `stdin` de `dsh`/`opencode` y esperar su salida limpia (arriesgando dejar sesiones sin volcar a disco).
  2. En Windows, `matarArbol()` (`app/electron/procesos.ts:18-22, 31-34`) ejecuta `execFile("taskkill", ["/T", "/F", "/PID", ...])`, que es **asíncrono**. Llamarlo justo antes de `process.exit(codigo)` (`dsh-puente.ts:801-802`) o dentro de `process.on("exit")` (los tres puentes: `dsh-puente.ts:815`, `agy-puente.ts:620`, `codex-puente.ts:377`, donde Node ya cerró el event loop) impide que el callback/trabajo asíncrono de `taskkill` llegue a completarse, pudiendo dejar procesos hijos huérfanos en Windows si el puente sale o recibe `SIGINT`/`SIGTERM`.
- **Por qué:** `terminar()` es síncrona y ejecuta `process.exit(codigo)` en la línea inmediatamente siguiente a `cliente?.matar()`, y el evento `exit` en Node sólo ejecuta código síncrono.
- **Cómo reproducir:** En Linux, verificar que `dsh-puente.ts` en cierre limpio (`stdin` EOF en reposo) mata a `dsh` con `SIGKILL` sin cerrar nunca `p.stdin.end()`. En Windows, lanzar `node` con `process.on("exit", () => execFile("taskkill", ...))` antes de salir mientras hay un hijo vivo: el proceso hijo sobrevive al salir el padre.
- **Arreglo propuesto:** Volver asíncrono el cierre limpio en `dsh-puente.ts` (`await cliente?.cerrar()` cuando cierra `stdin` en reposo o en `SIGTERM`/`SIGINT` antes de `process.exit()`), y para el respaldo de `exit` en Windows evaluar `execFileSync("taskkill", ...)` acotado (o job object / `matar` previo a `process.exit`) en `procesos.ts` para cierres forzados.
- **Archivos que tocaría el arreglo:** `app/electron/dsh-puente.ts`, `app/electron/agy-puente.ts`, `app/electron/codex-puente.ts`, `app/electron/procesos.ts`.

---

### PUENTES-18 · `comandosDeAgy()` bloquea el loop con `spawnSync` hasta 3 s y cachea `[]` de por vida tras un fallo único
- **Severidad:** baja  ·  **Confianza:** alta
- **Dónde:** `app/electron/agy-puente.ts` líneas 633-646 (`comandosDeAgy`)
- **Qué pasa:** Al responder el `initialize` inicial del puente, `comandosDeAgy()` corre `spawnSync` con timeout de 3000 ms (congelando el loop de stdin/stdout del puente mientras corre `agy plugin list --json`). Si por cualquier motivo temporal falla, sale con código distinto de 0 o vence el timeout una sola vez, guarda `comandosCache = []`. Como el chequeo siguiente es `if (comandosCache)` (`[]` es truthy en JavaScript), la lista vacía queda congelada para toda la vida del proceso puente.
- **Por qué:** Verificado en `agy-puente.ts:635-645`:
  ```ts
  if (comandosCache) return comandosCache;
  ...
  } catch {
    comandosCache = [];
  }
  return comandosCache;
  ```
- **Cómo reproducir:** En un test con `HILOS_AGY` apuntando a un script que falle la primera invocación de `plugin list --json` y devuelva skills en la segunda, enviar dos `initialize` seguidos al mismo `agy-puente`: el segundo sigue devolviendo `commands: []`.
- **Arreglo propuesto:** No asignar `comandosCache = []` en el bloque `catch` (devolver `[]` sin cachear el error, o cachear sólo cuando `r.status === 0` y no hubo error), y opcionalmente volverlo asíncrono con `execFile` en el manejador de `initialize`. Cubrir en `app/tests/agy-directo.test.ts`.
- **Archivos que tocaría el arreglo:** `app/electron/agy-puente.ts`, `app/tests/agy-directo.test.ts`.

---

### PUENTES-19 · `contexto-local.ts` oculta `AGENTS.md` si `CLAUDE.md` se recorta después de mencionarlo y limita a 4000 tokens un proyecto fuera de `~`
- **Severidad:** baja  ·  **Confianza:** alta
- **Dónde:** `app/electron/contexto-local.ts` líneas 163-164, 175-186 (`armarContexto`)
- **Qué pasa:**
  1. Cuando un `CLAUDE.md` excede el tope de tokens y `poner()` lo recorta, `agentsAparte` recibe el texto **sin recortar** (`claude = sinSecciones(await conImports(...), fuera)`). Si el contenido de `AGENTS.md` (o `@AGENTS.md`) venía después del punto de recorte, `!claude.includes(agents.trim())` da `false` y `AGENTS.md` no se agrega por separado aunque haya quedado mutilado.
  2. Cuando `cwd` está fuera de `home` (por ejemplo en `/mnt/disco/proyecto` o en otra unidad de Windows), `carpetasDe(home, cwd)` devuelve `[cwd]`. Luego `const [primero, ...proyecto] = textos;` mete el `CLAUDE.md` del proyecto en `primero` (el espacio reservado para `~/CLAUDE.md` con tope fijo de 4000 tokens en la línea 164) en vez de en `proyecto` (que usa todo el presupuesto `libre`).
- **Cómo reproducir:** Correr desde `app/`:
  ```bash
  node --experimental-strip-types -e '
  import { armarContexto } from "./electron/contexto-local.ts";
  const archivos = {
    "proj/CLAUDE.md": "intro\n" + "a\n".repeat(15000) + "reglas de agents",
    "proj/AGENTS.md": "reglas de agents",
  };
  const ctx = await armarContexto({
    home: "fake-home", cwd: "proj", ctx: 40000, perfil: "gemini",
    deps: { leer: async (f) => archivos[f] ?? null, hook: async () => "" },
  });
  console.log("partes:", JSON.stringify(ctx.partes), "has AGENTS:", ctx.texto.includes("AGENTS.md de proj"));
  '
  ```
  Salida observada: `partes: [{"titulo":"CLAUDE.md de proj","tokens":3999,"recortado":true}] has AGENTS: false` (se cortó antes de llegar a `reglas de agents` y tampoco incluyó `AGENTS.md`).
- **Arreglo propuesto:** Devolver desde `poner()` el texto efectivamente incluido (ya recortado) y pasárselo a `agentsAparte`, y sólo asignar `primero` como archivo de `~` cuando `path.dirname(textos[0][0]) === home` (dejando los demás en `proyecto`). Agregar test en `app/tests/contexto-local.test.ts`.
- **Archivos que tocaría el arreglo:** `app/electron/contexto-local.ts`, `app/tests/contexto-local.test.ts`.

---

### PUENTES-20 · `ClienteAcp.iniciar()` deja el proceso vivo si falla `initialize` y `this.llamadas` retiene cada `rawInput` sin limpiarse
- **Severidad:** baja  ·  **Confianza:** alta
- **Dónde:** `app/electron/acp.ts` líneas 124, 157-194, 314 (`ClienteAcp.iniciar`, `notificacion`)
- **Qué pasa:**
  1. En `iniciar()`, `this.hijo = p; this.vivo = true;` quedan asignados antes de `await this.pedir("initialize", ...)`. Si `initialize` rechaza (error JSON-RPC) o vence el timeout de 60 s sin que el hijo cierre, `iniciar()` lanza pero deja al subproceso vivo en segundo plano y al objeto `ClienteAcp` inutilizable (`if (this.hijo) throw new Error("acp: el agente ya está lanzado")`). `dsh-puente.ts` lo mitiga llamando a `c.matar()` en su `catch` (`610`), pero cualquier otro consumidor de `ClienteAcp` pierde el proceso.
  2. `this.llamadas` (`Map` en línea 124) guarda `u.rawInput` por cada `tool_call` en la línea 314 (`this.llamadas.set(u.toolCallId, u.rawInput)`) y nunca hace `delete(...)` cuando la herramienta termina (`tool_call_update` con `completed`/`failed`), reteniendo en memoria el payload completo de todas las llamadas (incluidos archivos enteros pasados a `write`/`edit`) mientras dure el agente ACP.
- **Por qué:** No existe `try/catch` que llame a `this.matar()` ni limpieza en `iniciar()`, ni borrado en `this.llamadas` en `notificacion()`.
- **Cómo reproducir:** Llamar a `new ClienteAcp(...)` contra un proceso que responda error JSON-RPC en `initialize` sin salir: `await c.iniciar()` rechaza dejando `c.activo === true` y el proceso colgado; una segunda llamada a `c.iniciar()` tira `"acp: el agente ya está lanzado"`.
- **Arreglo propuesto:** Envolver `await this.pedir("initialize", ...)` en `try/catch` dentro de `iniciar()` llamando a `this.matar()` y limpiando `this.hijo = null; this.vivo = false;` si falla; y en `notificacion()`, borrar `this.llamadas.delete(u.toolCallId)` cuando llegue `tool_call_update` con estado terminal (`completed`/`failed`), o al terminar un turno. Agregar test en `app/tests/acp.test.ts`.
- **Archivos que tocaría el arreglo:** `app/electron/acp.ts`, `app/tests/acp.test.ts`.

---

## Zonas que no llegué a mirar

- **Ejecución real contra los CLIs y Windows:** No se corrieron pruebas de extremo a extremo contra los binarios reales (`agy`, `codex`, `dsh`, `opencode`) ni sobre una máquina Windows nativa (`codex.cmd`, `dsh.cmd`, `taskkill`, manejo de rutas con mayúsculas/unidades distintas en `carpetasDe` de `contexto-local.ts`, permisos NTFS). Las reproducciones se hicieron por inspección línea a línea y ejecutando las funciones puras con Node en Linux.
- **Instalación real de `dsh-ajustes.ts`:** En `app/electron/dsh-ajustes.ts` no se detectaron fallos claros en código más allá de dependencias menores (`hayBin` en línea 90-91 no busca en `path.dirname(process.execPath)` a diferencia de `resolverNpm` en `binario.ts:214`), pero no se probó `instalarDsh` en vivo contra el registro de `npm` ni bajo distintas versiones de Node/npm en Windows y Linux.
- **Módulos auxiliares fuera de la lista explícita:** Archivos que colaboran con los puentes pero no estaban en la lista (`app/electron/agy-stream.ts` completo salvo `Traductor.fin`/`paso`/`respuesta`, `app/electron/dsh.ts` salvo `parsearModelo`, `app/electron/opencode.ts`, `app/electron/cortes.ts`, `app/electron/instrucciones-md.ts` salvo `@` imports, `app/electron/contexto-jsonl.ts`, `app/electron/lider.ts` fuera de los puntos de enlace `mandarDirecto`, `parar`, `fin` y `pidiendo`) sólo se consultaron en los puntos de integración necesarios para verificar los bugs reportados y no se auditaron de punta a punta.
