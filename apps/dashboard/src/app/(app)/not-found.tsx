import Link from "next/link";

/** Shown inside the signed-in shell, including when a non-admin opens the operations view. */
export default function DashboardNotFound() {
  return (
    <div className="page">
      <div className="empty">
        <h1>Page not found</h1>
        <p>The page doesn’t exist, or your account doesn’t have access to it.</p>
        <Link className="button button--primary" href="/overview">
          Go to overview
        </Link>
      </div>
    </div>
  );
}
