# Reglas: conectores

Salieron de `AGENTS.md` (sección «Cómo se trabaja» y «Mapa rápido»): van enteras, sin resumir.

## Uso de lo conectado

- **Uso de lo conectado (Ajustes > Conectores):** el orden por más usados / menos usados / último uso sale de `historial:consultar` (30 días) pasado por `usosDeHistorial` (`app/electron/usos-historial.ts`, puro, lo comparte con el catálogo de skills). El último día de uso sale de los días ya indexados (`Consulta.ultimo`: sólo nombres y días), sin tocar `PARSER`. Tres estados que no se mezclan: usado, **«sin uso en 30 días»** (0, nunca «nunca») y **«sin dato»** (null: hooks, plugins sin skills ni MCP, sin registro). Lo sin dato va siempre al final. Desde 200 filas un grupo se dibuja por bloques (`BloqueVirtual`). Lo controla `tests/conectores-vista.test.ts`.

## Tienda de plugins

- **Tienda de plugins (`electron/plugins-claude.ts`, pestaña Plugins de `src/paneles/AjustesConectores.tsx` y `Tienda*.tsx`):** `instalaciones`/`actualizado` de cada plugin salen de `~/.claude/plugins/plugin-catalog-cache.json`
(`catalog.plugins["plugin@catálogo"].unique_installs` / `.last_updated`), una caché interna de Claude Code: sólo se lee, y un archivo o campo que falta o no sirve es
`null` = «sin dato» (nunca 0 ni error; en el orden va siempre al final). La categoría es la del `marketplace.json`; sin ella, «Sin categoría». Filtro y orden son puros
(`conectores-vista.ts`: `ordenarPlugins`, `filtrarCategoria`, `categoriasDe`). Los tests arman un catálogo falso en un tmp (`tests/plugins-tienda.test.ts`) y nunca llaman a `claude`.

## Descubrir skills y conectores MCP

- **Descubrir skills y conectores MCP (Ajustes > Conectores, `app/electron/descubrir.ts`, UI «Descubrir» de `src/paneles/AjustesConectores.tsx` y `Tienda*.tsx` (lógica pura `tienda-logica.ts`, datos `tienda-datos.ts`) sobre `descubrir-vista.ts`; canales `descubrir:catalogo|previa|instalar`):** el main baja como DATOS el registro MCP oficial (`registry.modelcontextprotocol.io/v0/servers`, paginado) y el árbol de `anthropics/skills` (sin `docx`, `pdf`, `pptx`, `xlsx`: no son open source; su README dice «for demonstration and educational purposes only» y se muestra), con tope de bytes y de tiempo, y lo cachea en `$HILOS_STATE/descubrir.json`; sólo al abrir sin copia de hoy o con «Actualizar», nunca por sondeo. Cada fuente falla por separado y conserva lo viejo. La interfaz manda sólo un `id`: lo que se instala sale de lo guardado, nunca de lo que diga el renderer. Skill: copia a `~/.claude/skills/<nombre>` (nombre y cada ruta validados, sin pisar una existente, cada archivo verificado contra el sha de blob de GitHub, temporal + `rename`; la confirmación lista archivos y avisa de scripts, y la huella de la previa evita instalar algo distinto de lo que se vio). MCP remoto: sólo `https`, entra por `guardarServidor` (los mismos conectores propios); el de paquete NUNCA se ejecuta: se muestra su comando y enlace. No usar Smithery ni awesome-claude-code (licencia). Las fechas que faltan son «sin dato» (las skills no traen fecha). Los tests (`tests/descubrir.test.ts`) usan un servidor HTTP falso en 127.0.0.1 y un HOME temporal. Capturas: `HILOS_VARIANTE=descubrir|descubrir-vacio|descubrir-falla`.
