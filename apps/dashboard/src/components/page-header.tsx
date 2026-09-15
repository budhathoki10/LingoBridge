import type { ReactNode } from "react";

export function PageHeader({
  actions,
  description,
  title,
}: {
  actions?: ReactNode;
  description?: ReactNode;
  title: string;
}) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}
