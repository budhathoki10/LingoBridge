import type { SVGProps } from "react";
import { LOGO_GLYPH_PATH, LOGO_TILE_COLOR } from "../../lib/brand";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function IconBase({ children, size = 16, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {children}
    </svg>
  );
}

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg aria-hidden="true" className="brand__mark" height={size} viewBox="0 0 32 32" width={size}>
      <rect fill={LOGO_TILE_COLOR} height="32" rx="8" width="32" />
      <path d={LOGO_GLYPH_PATH} fill="#fff" />
    </svg>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3.8c.7 3.1 2.1 4.5 5.2 5.2-3.1.7-4.5 2.1-5.2 5.2C11.3 11.1 9.9 9.7 6.8 9 9.9 8.3 11.3 6.9 12 3.8Z" />
      <path
        d="M6.2 15.4c.3 1.5 1 2.2 2.5 2.5-1.5.3-2.2 1-2.5 2.5-.3-1.5-1-2.2-2.5-2.5 1.5-.3 2.2-1 2.5-2.5Z"
        fill="currentColor"
        stroke="none"
      />
    </IconBase>
  );
}

export function ExternalIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" />
    </IconBase>
  );
}
