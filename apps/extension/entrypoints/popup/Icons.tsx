import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18" {...props}>
      {children}
    </svg>
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
