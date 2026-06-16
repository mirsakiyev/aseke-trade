import { ArrowRight, Award, BookOpen, BookmarkPlus, Filter, Timer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../contexts/AuthContext";
import { loadGuides } from "../lib/contentApi";
import { supabase } from "../lib/supabase";
import { GUIDE_CATEGORIES, type Guide, type GuideCategory } from "../types/content";

type CategoryFilter = "All" | GuideCategory;

export function Guides() {
  const { user } = useAuth();
  const [guides, setGuides] = useState<Guide[]>([]);
  const [category, setCategory] = useState<CategoryFilter>("All");
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    loadGuides().then((result) => {
      if (!mounted) return;
      setGuides(result.data);
      setNotice(result.error);
      setIsLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, []);

  const filteredGuides = useMemo(
    () => guides.filter((guide) => category === "All" || guide.category === category),
    [category, guides]
  );

  const saveGuide = async (guideId: string) => {
    if (!supabase || !user) {
      setNotice("Login with Supabase connected to save guides.");
      return;
    }

    const { error } = await supabase.from("saved_guides").insert({
      user_id: user.id,
      guide_id: guideId
    });

    setNotice(error ? "This guide could not be saved. It may already be in your dashboard." : "Guide saved to your dashboard.");
  };

  return (
    <main className="page page-stack">
      <section className="page-title-row compact-title-row">
        <div>
          <p className="eyebrow">Guides and Tutorials</p>
          <h1>Crypto guides</h1>
          <p className="muted">
            Browse foundations, safety guides, market research, on-chain intelligence, and Trading Academy materials.
          </p>
        </div>
      </section>

      <section className="filter-bar" aria-label="Guide filters">
        <Filter size={18} />
        {(["All", ...GUIDE_CATEGORIES] as CategoryFilter[]).map((item) => (
          <button
            className={item === category ? "filter-pill active" : "filter-pill"}
            type="button"
            onClick={() => setCategory(item)}
            key={item}
          >
            {item}
          </button>
        ))}
      </section>

      {notice && <p className="soft-notice">{notice}</p>}

      {isLoading ? (
        <LoadingState label="Loading guides" />
      ) : (
        <section className="content-grid">
          {filteredGuides.map((guide) => {
            const isPremiumGuide = guide.is_premium || Boolean(guide.course?.is_premium);
            return (
              <article className="content-card" key={guide.id}>
                <div className="card-topline">
                  <span className={isPremiumGuide ? "status-pill premium" : "status-pill free"}>
                    {isPremiumGuide ? "Trading Academy" : "Free"}
                  </span>
                  <span className="meta-with-icon">
                    <Timer size={15} />
                    {guide.estimated_read_time} min
                  </span>
                  <span className="meta-with-icon">
                    <Award size={15} />
                    {guide.xp_reward} XP
                  </span>
                </div>
                <h2>{guide.title}</h2>
                <p>{guide.description}</p>
                <div className="card-meta">
                  <span>{guide.category}</span>
                  <span>{guide.difficulty}</span>
                </div>
                <div className="guide-preview">
                  <BookOpen size={16} />
                  <span>
                    {isPremiumGuide
                      ? "Trading Academy guide. Open it to review access options."
                      : "Free guide for building safer crypto foundations."}
                  </span>
                </div>
                <div className="inline-actions">
                  <Link className="ghost-button compact" to={`/guides/${guide.slug}`}>
                    Open guide
                    <ArrowRight size={16} />
                  </Link>
                  <button className="ghost-button compact" type="button" onClick={() => void saveGuide(guide.id)}>
                    <BookmarkPlus size={16} />
                    Save
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
