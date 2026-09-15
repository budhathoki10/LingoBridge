import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ children, size = 16, ...props }: IconProps & { children: ReactNode }) {
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

export const OverviewIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect height="7" rx="1.5" width="7" x="3.5" y="3.5" />
    <rect height="7" rx="1.5" width="7" x="13.5" y="3.5" />
    <rect height="7" rx="1.5" width="7" x="3.5" y="13.5" />
    <rect height="7" rx="1.5" width="7" x="13.5" y="13.5" />
  </Icon>
);

export const PhrasesIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 4.5h12a1.5 1.5 0 0 1 1.5 1.5v14l-4-2.5-3.5 2.5-3.5-2.5-4 2.5V6A1.5 1.5 0 0 1 6 4.5Z" />
    <path d="M8.5 9h7M8.5 12.5h4.5" />
  </Icon>
);

export const PreferencesIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </Icon>
);

export const ExtensionsIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 4.5a2 2 0 1 1 4 0V6h3.5A1.5 1.5 0 0 1 19 7.5V11h-1.5a2 2 0 1 0 0 4H19v3.5a1.5 1.5 0 0 1-1.5 1.5H14v-1.5a2 2 0 1 0-4 0V20H6.5A1.5 1.5 0 0 1 5 18.5V15h1.5a2 2 0 1 0 0-4H5V7.5A1.5 1.5 0 0 1 6.5 6H10V4.5Z" />
  </Icon>
);

export const PrivacyIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3.5 5 6.5v5c0 4.2 2.9 7.7 7 9 4.1-1.3 7-4.8 7-9v-5l-7-3Z" />
    <path d="m9.5 12 1.8 1.8 3.4-3.6" />
  </Icon>
);

export const AdminIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 19.5h16M6.5 16V11M11 16V6.5M15.5 16v-3.5M20 16V9" />
  </Icon>
);

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-4.2-4.2" />
  </Icon>
);

export const MenuIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);

export const CheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const MinusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 12h12" />
  </Icon>
);

export const TrashIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 7h15M10 11v6M14 11v6M9 7V4.5h6V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.5h6.4a1.5 1.5 0 0 0 1.5-1.5l.8-12" />
  </Icon>
);

export const DownloadIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
  </Icon>
);

export const SignOutIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14 4.5H6.5A1.5 1.5 0 0 0 5 6v12a1.5 1.5 0 0 0 1.5 1.5H14M10 12h10M16.5 8.5 20 12l-3.5 3.5" />
  </Icon>
);

export const ArrowRightIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5" />
  </Icon>
);

export const BrowserIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect height="15" rx="2" width="17" x="3.5" y="4.5" />
    <path d="M3.5 9h17M7 6.75h.01M9.5 6.75h.01" />
  </Icon>
);

export const BridgeMark = (props: IconProps) => (
  <Icon strokeWidth="2" {...props}>
    <path d="M4 16c2.5-5 13.5-5 16 0M8 13.5V18M16 13.5V18M4 18h16" />
  </Icon>
);
