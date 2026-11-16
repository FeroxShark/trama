# Señal de cierre por cupo (`$PA_STATE/cierre-cupo.json`)

Pedido del dueño (2026-11-15): cuando a una suscripción le queda poco cupo (≤ umbral, 5 % por defecto), cada trabajo que la usa
cierra ordenado (resumen para retomar, deja todo commiteado), no se lanzan workers nuevos en ella y, si así se eligió, se retoma
solo al reinicio de la ventana. El dueño puede seguir chateando: nada se bloquea.

Este archivo es la **única fuente** que leen el hook, `pa`/`reparto` y la interfaz. Lo escribe Trama (vigilante en
`app/electron/cierre-cupo.ts`, disco en `app/electron/cierre-cupo-disco.ts`) cada minuto y con cada `rate_limit_event` de un líder.

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
