"use client";

// `retry` refetches the page's server data; the older `reset` only re-rendered what the browser had.
export default function DashboardError({ retry }: { error: Error; retry: () => void }) {
  return (
    <div className="page">
      <div className="empty" role="alert">
        <h1>This page couldn’t load</h1>
        <p>
          The dashboard could not reach its data. Your saved phrases are unaffected. Try again, and
          if it keeps happening, check your connection.
        </p>
        <button className="button button--primary" onClick={() => retry()} type="button">
          Try again
        </button>
      </div>
    </div>
  );
}
