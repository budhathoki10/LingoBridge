import type { ReactNode } from "react";

export function PageHeader({
  actions,
  description,
  loading = false,
  title,
}: {
  actions?: ReactNode;
  description?: ReactNode;
  /**
   * For a loading placeholder. While a page streams in, React keeps the placeholder and the
   * finished page in the document together for a moment, so the placeholder's title is styled like
   * the heading but is not a second h1.
   */
  loading?: boolean;
  /** A string, or a placeholder while the page loads. */
  title: ReactNode;
}) {
  const Title = loading ? "div" : "h1";
  return (
    <header className="page-header">
      <div className="page-header__text">
        <Title className="page-header__title">{title}</Title>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}
