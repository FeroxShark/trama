# Código de terceros

## T3 Code

- Origen: <https://github.com/pingdotgg/t3code> (commit `d1034d62`, 2026-10-02), licencia MIT.
- Qué se tomó: la barra izquierda de B1 partió de `apps/web/src/components/Sidebar.tsx` y
  `apps/web/src/index.css`. El look ya no es el de T3 (desde el rediseño "D · Minimal" manda
  `referencias/diseno-D-minimal.dc.html`), pero quedan adaptados de ahí la estructura de la fila de
  hilo (`SidebarThreadRow`), la navegación por teclado de la lista y la idea del pulso de estado,
  reimplementado con un timer (`src/barra/latido.ts`).
- Dónde vive acá: `src/barra/Barra.tsx`, `src/barra/Fila.tsx`, `src/barra/piezas.tsx`,
  `src/barra/latido.ts`, `src/tiempo.ts`.

```
MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Skills de diseño (`skills/`)

- `skills/ui-ux-pro-max`: <https://github.com/nextlevelbuilder/ui-ux-pro-max-skill>, licencia MIT, © 2024 Next Level Builder.
- `skills/taste-skill`: <https://github.com/Leonxlnx/taste-skill>, licencia MIT, © 2026 Leonxlnx.
- Se redistribuyen enteras (sin `__pycache__`), cada una con su `LICENSE` copiado del repo de origen. `skills/diseno` es propia de trama.

## Geist y Geist Mono

- Origen: <https://github.com/vercel/geist-font> (Vercel, con Basement Studio), licencia SIL Open
  Font License 1.1.
- Qué se tomó: las dos fuentes variables, sin modificar.
- Dónde vive acá: `src/fuentes/Geist-Variable.woff2`, `src/fuentes/GeistMono-Variable.woff2`. El
  texto completo de la licencia está al lado, en `src/fuentes/OFL.txt`.

## Las fuentes que se eligen en Ajustes (B14)

Todas con licencia SIL Open Font License 1.1, sin modificar (salvo donde dice), en `src/fuentes/`;
el texto de la licencia de cada una, con su copyright, está al lado.

| Fuente | Origen | Archivos | Licencia |
|---|---|---|---|
| Inter | <https://github.com/rsms/inter> | `Inter-Variable.woff2` (subconjunto latino de Fontsource) | `OFL-Inter.txt` |
| IBM Plex Sans | <https://github.com/IBM/plex> | `IBMPlexSans-Variable.woff2` (subconjunto latino de Fontsource) | `OFL-IBMPlex.txt` |
| IBM Plex Mono | <https://github.com/IBM/plex> | `IBMPlexMono-Regular.woff2`, `-Medium`, `-SemiBold` | `OFL-IBMPlex.txt` |
| Source Sans 3 | <https://github.com/adobe-fonts/source-sans> | `SourceSans3-Variable.woff2` (subconjunto latino de Fontsource) | `OFL-SourceSans3.txt` |
| JetBrains Mono | <https://github.com/JetBrains/JetBrainsMono> | `JetBrainsMono-Variable.woff2` (el `.ttf` variable pasado a woff2 con `woff2_compress`) | `OFL-JetBrainsMono.txt` |
| Fira Code | <https://github.com/tonsky/FiraCode> (5.2) | `FiraCode-Variable.woff2` | `OFL-FiraCode.txt` |
