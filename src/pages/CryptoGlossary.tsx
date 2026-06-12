import { BookOpenText, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { cryptoGlossaryCategories } from "../data/cryptoGlossary";

export function CryptoGlossary() {
  const [search, setSearch] = useState("");
  const totalTerms = cryptoGlossaryCategories.reduce((total, category) => total + category.terms.length, 0);

  const filteredCategories = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return cryptoGlossaryCategories;

    return cryptoGlossaryCategories
      .map((category) => ({
        ...category,
        terms: category.terms.filter((term) =>
          [
            category.title,
            term.term,
            term.definition,
            ...term.tags
          ]
            .join(" ")
            .toLowerCase()
            .includes(query)
        )
      }))
      .filter((category) => category.terms.length > 0);
  }, [search]);

  const matchingTerms = filteredCategories.reduce((total, category) => total + category.terms.length, 0);

  return (
    <main className="page page-stack glossary-page">
      <section className="page-title-row glossary-title-row">
        <div>
          <p className="eyebrow">Crypto Glossary</p>
          <h1>Crypto terms, clearly defined</h1>
          <p className="muted">
            A practical reference for market language, wallet safety, blockchain mechanics, DeFi, and
            trading risk.
          </p>
        </div>
        <span className="charts-title-mark" aria-hidden="true">
          <BookOpenText size={34} />
        </span>
      </section>

      <section className="glossary-search-band" aria-label="Glossary search">
        <label className="glossary-search-label">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">Search glossary terms</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search terms, symbols, or topics"
          />
        </label>
        <span>
          {matchingTerms} / {totalTerms} terms
        </span>
      </section>

      {filteredCategories.length ? (
        filteredCategories.map((category) => (
          <section className="glossary-section" key={category.title}>
            <div className="glossary-section-heading">
              <div>
                <p className="eyebrow">{category.title}</p>
                <h2>{category.description}</h2>
              </div>
              <span className="status-pill">{category.terms.length} terms</span>
            </div>

            <div className="glossary-grid">
              {category.terms.map((term) => (
                <article className="glossary-term" key={term.term}>
                  <h3>{term.term}</h3>
                  <p>{term.definition}</p>
                  <div className="glossary-tags" aria-label={`${term.term} tags`}>
                    {term.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))
      ) : (
        <section className="section-panel">
          <h2>No glossary matches</h2>
          <p className="muted">Try a different term, symbol, or category.</p>
        </section>
      )}
    </main>
  );
}
