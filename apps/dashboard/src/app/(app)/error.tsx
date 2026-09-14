"use client";

export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="page">
      <div className="empty" role="alert">
        <h1>This page couldn’t load</h1>
        <p>
          The dashboard could not reach its data. Your saved phrases are unaffected. Try again, and
          if it keeps happening, check your connection.
        </p>
        <button className="button button--primary" onClick={reset} type="button">
          Try again
        </button>
      </div>
    </div>
  );
}
