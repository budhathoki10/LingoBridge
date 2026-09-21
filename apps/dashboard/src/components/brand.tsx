import Link from "next/link";
import { LogoMark } from "./icons";

/** The logo lockup. Pass `href` where the brand also navigates home. */
export function Brand({ href }: { href?: string }) {
  const content = (
    <>
      <LogoMark />
      <span>LingoBridge</span>
    </>
  );
  return href ? (
    <Link aria-label="LingoBridge home" className="brand" href={href}>
      {content}
    </Link>
  ) : (
    <span className="brand">{content}</span>
  );
}
