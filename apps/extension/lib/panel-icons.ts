import { LOGO_GLYPH_PATH, LOGO_TILE_COLOR } from "./brand";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Outline icons on a 24px grid, drawn with the current text color. */
const ICON_PATHS = {
  alert: "M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17ZM12 8v4.5M12 15.8v.2",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  bookmark: "M7 4.5h10a1 1 0 0 1 1 1V20l-6-3.6L6 20V5.5a1 1 0 0 1 1-1Z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  close: "M17 7 7 17M7 7l10 10",
  copy: "M9 9h9.5a.5.5 0 0 1 .5.5V19a.5.5 0 0 1-.5.5H9a.5.5 0 0 1-.5-.5V9.5A.5.5 0 0 1 9 9ZM15.5 9V5.5A.5.5 0 0 0 15 5H5.5a.5.5 0 0 0-.5.5V15a.5.5 0 0 0 .5.5H9",
  languages:
    "M4 6h8M8 4v2M10.5 6c-.6 3.3-2.8 6-6 7.5M6 8.5c1 2 2.8 3.6 5 4.5M13 20l3.5-8 3.5 8M14.2 17.3h4.6",
  replace: "M4 8h12.5l-3-3M20 16H7.5l3 3",
  retry: "M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.2h-4.2",
  shield: "M12 3.5 5.5 6v5.2c0 4 2.7 7.5 6.5 9.3 3.8-1.8 6.5-5.3 6.5-9.3V6L12 3.5Z",
  spark:
    "M12 3.8c.7 3.1 2.1 4.5 5.2 5.2-3.1.7-4.5 2.1-5.2 5.2C11.3 11.1 9.9 9.7 6.8 9 9.9 8.3 11.3 6.9 12 3.8ZM6.4 15.2c.3 1.5 1 2.2 2.5 2.5-1.5.3-2.2 1-2.5 2.5-.3-1.5-1-2.2-2.5-2.5 1.5-.3 2.2-1 2.5-2.5Z",
  speaker: "M11 5.5 7 9H4.5v6H7l4 3.5v-13ZM15 9a4.2 4.2 0 0 1 0 6M17.8 6.5a8 8 0 0 1 0 11",
  star: "M12 4l2.5 5.1 5.6.8-4 3.9.9 5.6L12 16.8l-5 2.6.9-5.6-4-3.9 5.6-.8L12 4Z",
  stop: "M8 8h8v8H8z",
  warning: "M12 4.5 3 19.5h18L12 4.5ZM12 10v4M12 16.8v.2",
} as const;

export type PanelIconName = keyof typeof ICON_PATHS;

export function iconSvg(name: PanelIconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", ICON_PATHS[name]);
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("stroke-width", "1.8");
  svg.append(path);
  return svg;
}

/** The magic action keeps a filled spark so it reads clearly on the accent button. */
export function magicSvg(): SVGSVGElement {
  const svg = iconSvg("spark");
  svg.firstElementChild?.setAttribute("fill", "currentColor");
  svg.firstElementChild?.setAttribute("stroke-width", "1.2");
  return svg;
}

export function logoSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "brand__mark");
  svg.setAttribute("viewBox", "0 0 32 32");
  const tile = document.createElementNS(SVG_NS, "rect");
  tile.setAttribute("width", "32");
  tile.setAttribute("height", "32");
  tile.setAttribute("rx", "8");
  tile.setAttribute("fill", LOGO_TILE_COLOR);
  const glyph = document.createElementNS(SVG_NS, "path");
  glyph.setAttribute("d", LOGO_GLYPH_PATH);
  glyph.setAttribute("fill", "#fff");
  svg.append(tile, glyph);
  return svg;
}
