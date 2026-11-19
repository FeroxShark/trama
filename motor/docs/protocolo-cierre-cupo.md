# Señal de cierre por cupo (`$PA_STATE/cierre-cupo.json`)

Pedido del dueño (2026-11-15): cuando a una suscripción le queda poco cupo (≤ umbral, 5 % por defecto), cada trabajo que la usa
cierra ordenado (resumen para retomar, deja todo commiteado), no se lanzan workers nuevos en ella y, si así se eligió, se retoma
solo al reinicio de la ventana. El dueño puede seguir chateando: nada se bloquea.

Este archivo es la **única fuente** que leen el hook, `pa`/`reparto` y la interfaz. Lo escribe Trama (vigilante en
`app/electron/cierre-cupo.ts`, disco en `app/electron/cierre-cupo-disco.ts`) cada minuto y con cada `rate_limit_event` de un líder.
Una entrada se suelta al pasar `vuelve` o con un reinicio antes de tiempo: una lectura con un reinicio posterior y cupo de sobra, o 60 s seguidos leyendo
más de `umbral` + 10 puntos (una sola lectura alta puede ser vieja).

## Formato

```json
{
  "version": 1,
  "ts": 1763240000,
  "retomar_solo": false,
  "entradas": [
    { "proveedor": "claude", "cuenta": "claude", "ventana": "5h", "restante": 4, "umbral": 5, "vuelve": 1763250000, "desde": 1763240000 },
    { "proveedor": "google", "cuenta": "google", "ventana": "7d", "grupo": "gemini-pro", "restante": 3, "umbral": 5, "vuelve": 1763800000, "desde": 1763241000 }
  ]
}
```

- `ts`: epoch s de la última escritura. `retomar_solo`: lo de Ajustes (`cierre.retomar_solo`).
- `proveedor`: `claude`, `google` o `chatgpt`. `cuenta`: la de siempre se llama como el proveedor; una cuenta agregada de Claude, su id.
- `ventana`: `5h` o `7d` (u otro id de `reparto --cupos`). `grupo`: sólo Google, el grupo de modelos de `agy`; quien no sepa a qué
  grupo va un modelo trata la entrada como de toda la suscripción.
- `restante`: % que queda (entero 0..100). `umbral`: el de Ajustes cuando se disparó. `vuelve`: epoch s del reinicio (`null`: no se
  sabe). `desde`: epoch s en que se cruzó.
- Una entrada vive desde que se cruza el umbral hasta que pasa `vuelve`; se dispara una sola vez por ventana
  (proveedor + cuenta + ventana + grupo + `vuelve`). Sin `vuelve`, sale cuando vuelve a haber cupo.
- **Archivo ausente = nada se cierra** (sin entradas, Trama lo borra). Versión distinta de 1 o JSON roto: ignorarlo.
- Escritura atómica (temporal en la misma carpeta + `rename`).

## Qué modelo usa qué suscripción

`suscripcionDeModelo(modelo)` (`app/electron/cierre-cupo.ts`): `claude-*` → `claude`; `agy:*` y `gemini-*` → `google`;
`codex:*` y `gpt*` → `chatgpt`; OpenCode, `dsh:`, Ollama y lo demás → `null` (sin cupo, nunca se cierran).

## Ajustes (`~/.config/trama/modelos.json`)

```json
{ "cierre": { "activo": true, "umbral": 5, "retomar_solo": false } }
```

Sin la clave (o sin un campo) vale eso de fábrica. `umbral`: entero de 2 a 20. Con `activo: false` Trama no escribe nada (y borra la señal).

## Dentro de Trama

`cierreCupo.alCierreCupo(fn)` (exportado de `app/electron/nucleo.ts`): `fn(entrada)` con cada entrada que se dispara.

## Quién lee la señal

- **Hook `motor/hooks/cierre-cupo.mjs`** (PostToolUse y UserPromptSubmit del `claude` oficial: líderes de la app, de terminal y workers de `pa`). Si hay una entrada
  `claude` de la cuenta de la sesión (`CLAUDE_CONFIG_DIR` ↔ id de `cuentas.json`; sin él, `claude`), inyecta `additionalContext` UNA vez por sesión y ventana
  (marca `$PA_STATE/cierre-cupo/visto/<session_id>/<ventana>-<desde>`, creada con `wx`). Sin señal hace un `stat` y sale; nunca bloquea. No corre con `ANTHROPIC_BASE_URL`.
  Worker = el entorno trae `PA_WORKER=1` (lo pone `pa`): texto con los pasos de `CIERRE_TAREA` (`CIERRE_PASOS`, `cli/pa/contrato.ts`). Líder: no arrancar nada,
  dejar commiteado, escribir el resumen para retomar en `<HILOS_STATE>/relevos/<session_id>.md` (el `archivoRelevo` de la app; un líder de terminal usa el mismo
  lugar; la app lo relee al relanzar al líder), mandar a cerrar a sus workers y una línea al dueño.
- **Textos** (es/en) en un solo lugar: `motor/hooks/cierre-cupo-textos.mjs`; el idioma sale de `preferencias.json` de la app (o `LANG`). Los carga también el main
  (`electron/cierre-cupo-texto.ts`).
- **Registro:** `settingsWorker` (workers), un segundo `--settings` en cada líder de Claude de la app (`argvLider`, `cierreCupo`), `registrarEnAjustes` (`cli/hooks.ts`,
  `settings.json` del usuario) y `registrar_cierre` de `instalar-producto.sh`. Claude Code no repite un comando idéntico; si hubiera dos distintos, la marca `wx` evita el doble aviso.
- **Líderes que no corren hooks** (Gemini, dsh, opencode): `nucleo.ts` escucha `alCierreCupo` y encola el texto de líder (fila de sistema) a los vivos que **responden**
  y cuya suscripción (`suscripcionDeModelo`) coincide. Un líder ocioso no se despierta.
- **`pa` y `reparto`** (el TS; el bash y el python están congelados) leen la señal con `cli/cierre-cupo-lectura.ts`: `reparto` descarta como candidata a la suscripción cerrada
  («sin cupo: vuelve a las HH:MM»; sin otra con cupo sale `todo_lleno` con `vuelve_antes` y `sin_cupo=esperar` hace cola, `cli/pa/cupo.ts`); `pa -m` forzado a ella sale con 76 y el mismo mensaje.

### Límites conocidos

- **Workers por `agy` u opencode** (y codex): no hay canal para avisarles a mitad de una corrida, así que no reciben el aviso; sólo se evita lanzar otros nuevos.
- Una entrada de Google con `grupo` se trata como de toda la suscripción.
- El hook usa `node` del PATH; en Windows, el de Trama sólo en el registro de `registrarEnAjustes` (FALTA EN WINDOWS: pasar el `node.exe` empaquetado a los líderes de la app).
