import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { LOGO_GLYPH_PATH, LOGO_TILE_COLOR, LOGO_VIEWBOX } from "@lingobridge/design-tokens/brand";
import { ImageResponse } from "next/og";
import { BRAND_BACKGROUND, SITE_NAME } from "./site";

/** Open Graph's recommended size; X renders the same file for summary_large_image cards. */
export const SHARE_IMAGE_SIZE = { height: 630, width: 1200 } as const;
export const SHARE_IMAGE_TYPE = "image/png";

// Static instances of the landing page's IBM Plex Sans: the image renderer reads neither WOFF2
// nor variable fonts. Share images render at build time, from the dashboard app directory.
const FONT_DIRECTORY = join(process.cwd(), "src", "assets", "fonts");

const INK = "#1b1b19";
const INK_SECONDARY = "#5b5b56";
const BORDER = "#e1e1dd";

interface ShareImageContent {
  eyebrow: string;
  points: readonly string[];
  subtitle: string;
  title: string;
}

export async function renderShareImage({ eyebrow, points, subtitle, title }: ShareImageContent) {
  const [regular, semiBold] = await Promise.all([
    readFile(join(FONT_DIRECTORY, "IBMPlexSans-Regular.ttf")),
    readFile(join(FONT_DIRECTORY, "IBMPlexSans-SemiBold.ttf")),
  ]);

  return new ImageResponse(
    <div
      style={{
        background: BRAND_BACKGROUND,
        borderTop: `10px solid ${LOGO_TILE_COLOR}`,
        color: INK,
        display: "flex",
        flexDirection: "column",
        fontFamily: "IBM Plex Sans",
        height: "100%",
        justifyContent: "space-between",
        padding: "56px 72px 64px",
        width: "100%",
      }}
    >
      <div style={{ alignItems: "center", display: "flex", gap: 18 }}>
        <svg aria-hidden="true" height="56" viewBox={LOGO_VIEWBOX} width="56">
          <rect fill={LOGO_TILE_COLOR} height="32" rx="8" width="32" />
          <path d={LOGO_GLYPH_PATH} fill="#ffffff" />
        </svg>
        <span style={{ fontSize: 34, fontWeight: 600, letterSpacing: -0.5 }}>{SITE_NAME}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1056 }}>
        <span style={{ color: LOGO_TILE_COLOR, fontSize: 26, fontWeight: 600 }}>{eyebrow}</span>
        <span style={{ fontSize: 64, fontWeight: 600, letterSpacing: -1.5, lineHeight: 1.08 }}>
          {title}
        </span>
        <span style={{ color: INK_SECONDARY, fontSize: 30, lineHeight: 1.35 }}>{subtitle}</span>
      </div>

      <div style={{ display: "flex", gap: 14 }}>
        {points.map((point) => (
          <span
            key={point}
            style={{
              background: "#ffffff",
              border: `2px solid ${BORDER}`,
              borderRadius: 999,
              color: INK,
              fontSize: 22,
              padding: "10px 22px",
            }}
          >
            {point}
          </span>
        ))}
      </div>
    </div>,
    {
      ...SHARE_IMAGE_SIZE,
      fonts: [
        { data: regular, name: "IBM Plex Sans", style: "normal", weight: 400 },
        { data: semiBold, name: "IBM Plex Sans", style: "normal", weight: 600 },
      ],
    },
  );
}
