import { ArrowRight, Crown, GraduationCap } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { loadCourses } from "../lib/contentApi";
import { formatMoney } from "../lib/validation";
import type { Course } from "../types/content";

export function Courses() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    loadCourses().then((result) => {
      if (!mounted) return;
      setCourses(result.data);
      setNotice(result.error);
      setIsLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <main className="page page-stack">
      <section className="page-title-row">
        <div>
          <p className="eyebrow">Courses</p>
          <h1>Structured crypto education for better trading decisions</h1>
          <p className="muted">
            Start with foundations, then move toward Trading Academy topics like market structure,
            technical analysis, risk management, futures, and trading psychology.
          </p>
        </div>
        <Link className="platinum-button" to="/trading-academy">
          <Crown size={17} />
          Join Trading Academy
        </Link>
      </section>

      {notice && <p className="soft-notice">{notice}</p>}

      {isLoading ? (
        <LoadingState label="Loading courses" />
      ) : (
        <section className="content-grid course-grid">
          {courses.map((course) => (
            <article className="content-card course-card" key={course.id}>
              <div className="card-topline">
                <span className={course.is_premium ? "status-pill premium" : "status-pill free"}>
                  {course.is_premium ? "Trading Academy" : "Free"}
                </span>
                <span className="meta-with-icon">
                  <GraduationCap size={15} />
                  {course.difficulty}
                </span>
              </div>
              <h2>{course.title}</h2>
              <p>{course.description}</p>
              <div className="card-meta">
                <span>{course.is_premium ? "Trading Academy access" : formatMoney(course.price_cents)}</span>
                <span>
                  {course.guides.length > 0
                    ? `${course.guides.length} guides`
                    : `${course.modules.reduce((count, module) => count + module.lessons.length, 0)} lessons`}
                </span>
              </div>
              <Link className="text-link" to={`/courses/${course.slug}`}>
                View learning path
                <ArrowRight size={16} />
              </Link>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
