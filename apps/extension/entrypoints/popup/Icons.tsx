import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18" {...props}>
      {children}
    </svg>
  );
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m8 10 4 4 4-4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path
        d="m6.5 12.5 3.4 3.4 7.7-8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </IconBase>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path
        d="m7 7 10 10M17 7 7 17"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </IconBase>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="10.8" cy="10.8" r="5.8" stroke="currentColor" strokeWidth="1.8" />
      <path d="m15.2 15.2 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path
        d="M12 3.8c.7 3.1 2.1 4.5 5.2 5.2-3.1.7-4.5 2.1-5.2 5.2C11.3 11.1 9.9 9.7 6.8 9 9.9 8.3 11.3 6.9 12 3.8Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <path
        d="M6.2 15.4c.3 1.5 1 2.2 2.5 2.5-1.5.3-2.2 1-2.5 2.5-.3-1.5-1-2.2-2.5-2.5 1.5-.3 2.2-1 2.5-2.5Z"
        fill="currentColor"
      />
    </IconBase>
  );
}

export function StarIcon({ fill = "none", ...props }: IconProps) {
  return (
    <IconBase fill={fill} {...props}>
      <path
        d="m12 3.8 2.45 4.96 5.48.8-3.97 3.86.94 5.46L12 16.3l-4.9 2.58.94-5.46-3.97-3.86 5.48-.8L12 3.8Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </IconBase>
  );
}

export function SwapIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path
        d="M7 7h11l-3-3M17 17H6l3 3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </IconBase>
  );
}
