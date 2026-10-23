// Los logos de las empresas de los modelos, para el menú del selector: SVG propios, de un solo color (`currentColor`: siguen al
// texto del tema, también en hover y en la fila elegida), sin red ni imágenes. El de Anthropic es su "A"; el de Qwen y el de
// PrismML son marcas simplificadas (un hexágono con su cola, un prisma con su haz), no los archivos oficiales.
import { Cpu } from "lucide-react";
import { t } from "../i18n";
import type { Empresa } from "./modelos";

const A = { viewBox: "0 0 24 24", width: 14, height: 14, "aria-hidden": true, focusable: false, className: "logo" } as const;
const TRAZO = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const LOGOS: Record<Empresa, () => React.ReactElement> = {
  anthropic: () => (
    <svg {...A}>
      <path
        fill="currentColor"
        d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5527h3.7442L10.5363 3.541Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z"
      />
    </svg>
  ),
  // Gemini: su estrella de cuatro puntas; el de Google es el mismo (los modelos son de Gemini).
  google: () => (
    <svg {...A}>
      <path {...TRAZO} d="M12 2.5c.7 5.2 4.3 8.8 9.5 9.5-5.2.7-8.8 4.3-9.5 9.5-.7-5.2-4.3-8.8-9.5-9.5 5.2-.7 8.8-4.3 9.5-9.5Z" />
    </svg>
  ),
  qwen: () => (
    <svg {...A}>
      <path {...TRAZO} d="M12 2.5 20.2 7.25v9.5L12 21.5 3.8 16.75v-9.5Z" />
      <circle {...TRAZO} cx="12" cy="11.6" r="3.1" />
      <path {...TRAZO} d="m14.3 13.9 2.2 2.6" />
    </svg>
  ),
  // Ollama: la cabeza de una llama simplificada, con sus dos orejas.
  ollama: () => (
    <svg {...A}>
      <path {...TRAZO} d="M7.5 9.5V3.8m9 5.7V3.8M6 21v-6.2c0-3.2 2.7-5.3 6-5.3s6 2.1 6 5.3V21" />
      <circle cx="9.7" cy="13.2" r="0.9" fill="currentColor" />
      <circle cx="14.3" cy="13.2" r="0.9" fill="currentColor" />
    </svg>
  ),
  prismml: () => (
    <svg {...A}>
      <path {...TRAZO} d="M12 3.5 21 19.5H3Z" />
      <path {...TRAZO} d="M1.5 13.2h5.2M17.3 11.6l4.2-2M17.9 14l3.6.8" />
    </svg>
  ),
};

/** El logo de la empresa del modelo. */
export const Logo = ({ empresa }: { empresa: Empresa }) => LOGOS[empresa]();

/** El chip de "corre en la GPU de esta máquina", junto al nombre de un modelo local. */
export const ChipLocal = () => (
  <span className="loc" data-tip={t("modelo.localTip")}>
    <Cpu size={13} strokeWidth={1.8} aria-hidden="true" />
  </span>
);
