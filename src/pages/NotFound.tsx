import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <main className="page narrow-page">
      <section className="section-panel">
        <p className="eyebrow">404</p>
        <h1>Page not found</h1>
        <p className="muted">The page you are looking for is not available.</p>
        <Link className="primary-button" to="/">
          Return home
        </Link>
      </section>
    </main>
  );
}
