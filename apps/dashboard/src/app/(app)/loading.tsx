export default function Loading() {
  return (
    <div aria-busy="true" className="page">
      <p className="visually-hidden" role="status">
        Loading
      </p>
      <div className="page-header">
        <div className="page-header__text">
          <div className="skeleton skeleton--title" />
        </div>
      </div>
      <div className="stats">
        {[0, 1, 2].map((key) => (
          <div className="stat" key={key}>
            <div className="skeleton skeleton--line" />
            <div className="skeleton skeleton--value" />
          </div>
        ))}
      </div>
      <div className="data-list">
        {[0, 1, 2, 3].map((key) => (
          <div className="row" key={key}>
            <span />
            <div className="row__phrase">
              <div className="skeleton skeleton--line" />
              <div className="skeleton skeleton--line skeleton--short" />
            </div>
            <span />
          </div>
        ))}
      </div>
    </div>
  );
}
