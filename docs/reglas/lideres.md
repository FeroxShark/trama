# Reglas: lideres

Salieron de `AGENTS.md` (sección «Cómo se trabaja» y «Mapa rápido»): van enteras, sin resumir.

## Líderes: carpeta, cola, cuenta, actividad y título

- **Carpeta del líder nuevo y retirados:** el selector arranca siempre en «Auto» (`lider:nuevo` con `auto: true`; el main infiere con el registry de
SU máquina, `app/electron/carpeta-auto.ts`, sin modelo); lo elegido a mano manda. Un proyecto `estado: retirado` no se infiere ni se ofrece, y lo
que corrió ahí se ve en la carpeta de su `reemplazado_por` (`app/electron/reemplazos.ts`; el `proyecto` del hilo no se toca: es el de `pa`).
El riel ubica a un líder por worker, primer mensaje o lo movido a mano, nunca por su cwd. Detalle en `docs/estado/carpeta-auto-y-retirados.md`.

## Cola de mensajes del líder

- **Cola de mensajes del líder (`app/electron/cola.ts`, se ve en `app/src/hilo/Bandeja.tsx`):** lo encolado con el líder trabajando sale TODO JUNTO en un solo
mensaje (`juntar`), nunca uno por turno. Por defecto se entrega a mitad del turno, sin interrumpir, en el próximo límite de
herramienta (`lider.mandarDirecto`, tras `AGRUPAR_MS`, 8 s, que deja editar antes de que salga y se reinicia con cada cambio); los motores sin ese canal (locales) lo entregan al
terminar el turno. Ya no hay "Mandar ya" aparte: Ctrl+Enter es un Enter más. El mensaje no está en el chat hasta que entra: vive en la solapa de arriba de la caja, con Editar, Borrar y «Enviar ahora» (corta el paso, siempre preguntando).
Nunca se pierde: en disco está todo lo que no entró, con su error e imágenes (`camino`, cada imagen en su archivo). Lo ya pasado al stdin no se puede retirar: queda en la solapa como «En camino». Detalle en `motor/docs/traspaso.md`.

## Cuenta de cada chat

- **Cuenta de cada chat (Claude):** «Usar en nuevos» (riel y Plan y cupos) sólo vale para los chats nuevos; cada chat guarda su cuenta (`Guardado.cuenta`) y se cambia desde el chat
(`CuentaLider`, `lider:cuenta`). Con la cuenta del chat en el tope (≥ 80 %), `OfertaCuenta` (`ofertaDeCambio` en `barra/cupos-riel-logica.ts`) ofrece pasar a otra con lugar: sólo
ofrece, nunca cambia sola. Toda cuenta muestra 5 h y semana juntas, y «sin dato» si falta una (`carrilesCompletos`, `Mini` del riel): nunca el renglón vacío. Lo controla `tests/oferta-cuenta.test.ts`.

## Reinicio y actividad de los líderes

- **Reinicio y actividad de los líderes (`app/electron/actividad-lider.ts`):** la `actividad` de un líder de la app es su último turno real, nunca
que se haya levantado su proceso. `reanudarDormidos` sólo levanta a los dormidos con un turno en las últimas 24 h, o workers vivos, o cola; el resto
queda sin proceso y su próximo mensaje hace `--resume`. «Limpiar chats» (`src/barra/Limpiar.tsx`, lógica en `limpiar-logica.ts`) archiva los quietos.
(En este repo no hay `docs/estado/`: lo que ve el usuario de esto está en `src/barra/CONVENCIONES.md`.)

## Títulos de los chats (líderes) estables

- **Títulos de los chats (líderes) estables (`app/electron/titulo-estable.ts`, instancia en `titulo-fijo.ts`, `titulos-fijos.json`):** un título ya mostrado no se
recalcula en un arranque, reinicio del motor ni relectura del transcript. Lo puesto a mano en Claude Code (`/rename`, `name` de la sesión) manda y no se
pierde si deja de verse; el recorte del primer mensaje (provisorio) sólo lo reemplaza el primer título bueno (`ai-title` o generado), y ése queda. El rename desde
Trama vive en `nombres.json` (`titulos`) y gana en la barra. Cualquier reparación de títulos (`corregirBasura`) sólo toca lo automático (`tienePropio`).
Un título nuevo del líder pasa por `titulosFijos.titulo`, no por `tituloLider` a secas. Lo controla `tests/titulo-estable.test.ts`.
