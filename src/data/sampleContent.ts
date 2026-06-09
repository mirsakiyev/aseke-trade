import type { Course, CourseDifficulty, Difficulty, Guide, GuideCategory } from "../types/content";

const now = new Date("2026-06-05T12:00:00.000Z").toISOString();

const courseRows = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    title: "Crypto Basics",
    slug: "crypto-basics",
    description:
      "Start from zero. Learn crypto, blockchain, wallets, exchanges, and safe self-custody before risking real capital.",
    difficulty: "Beginner" as CourseDifficulty,
    price_cents: 0,
    is_premium: false,
    is_archived: false,
    sort_order: 1,
    created_at: now,
    updated_at: now
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    title: "Investing & Market Research",
    slug: "investing-market-research",
    description:
      "Learn project research, tokenomics, market cycles, and stronger market judgment before entering trades.",
    difficulty: "Intermediate" as CourseDifficulty,
    price_cents: 0,
    is_premium: false,
    is_archived: false,
    sort_order: 2,
    created_at: now,
    updated_at: now
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    title: "Trading Academy",
    slug: "trading-academy",
    description:
      "Premium trading education for market structure, technical analysis, risk, psychology, futures, derivatives, and strategy.",
    difficulty: "Advanced" as CourseDifficulty,
    price_cents: 0,
    is_premium: true,
    is_archived: false,
    sort_order: 3,
    created_at: now,
    updated_at: now
  },
  {
    id: "10000000-0000-4000-8000-000000000004",
    title: "DeFi & On-Chain Intelligence",
    slug: "defi-on-chain-intelligence",
    description:
      "Learn how DeFi works and how on-chain data can support stronger market awareness and trading context.",
    difficulty: "Advanced" as CourseDifficulty,
    price_cents: 0,
    is_premium: false,
    is_archived: false,
    sort_order: 4,
    created_at: now,
    updated_at: now
  },
  {
    id: "10000000-0000-4000-8000-000000000005",
    title: "Blockchain Development",
    slug: "blockchain-development",
    description:
      "A builder-focused introduction to blockchain concepts, smart contracts, and development fundamentals.",
    difficulty: "Expert" as CourseDifficulty,
    price_cents: 0,
    is_premium: false,
    is_archived: false,
    sort_order: 5,
    created_at: now,
    updated_at: now
  }
] satisfies Omit<Course, "modules" | "guides">[];

function courseMeta(courseId: string): Guide["course"] {
  const course = courseRows.find((item) => item.id === courseId);
  return course
    ? {
        id: course.id,
        title: course.title,
        slug: course.slug,
        is_premium: course.is_premium
      }
    : null;
}

function guide(
  id: string,
  course_id: string,
  title: string,
  slug: string,
  description: string,
  category: GuideCategory,
  difficulty: Difficulty,
  sort_order: number,
  is_premium = false
): Guide {
  return {
    id,
    course_id,
    title,
    slug,
    description,
    content: "Coming soon.",
    category,
    difficulty,
    estimated_read_time: 8,
    price_cents: 0,
    is_premium,
    is_archived: false,
    sort_order,
    created_by: null,
    created_at: now,
    updated_at: now,
    course: courseMeta(course_id)
  };
}

export const sampleGuides: Guide[] = [
  guide(
    "20000000-0000-4000-8000-000000000001",
    "10000000-0000-4000-8000-000000000001",
    "Crypto Foundations",
    "crypto-foundations",
    "Build the foundation for Bitcoin, crypto assets, wallets, exchanges, transactions, and self-custody.",
    "Crypto Basics",
    "Beginner",
    1
  ),
  guide(
    "20000000-0000-4000-8000-000000000002",
    "10000000-0000-4000-8000-000000000001",
    "Crypto Safety & Security",
    "crypto-safety-security",
    "Protect your learning journey with seed phrase safety, account protection, exchange security, and phishing awareness.",
    "Crypto Basics",
    "Beginner / Intermediate",
    2
  ),
  guide(
    "20000000-0000-4000-8000-000000000003",
    "10000000-0000-4000-8000-000000000002",
    "Portfolio Building & Investing",
    "portfolio-building-investing",
    "Create a risk-aware framework for allocation, position sizing, conviction, and long-term market exposure.",
    "Investing & Market Research",
    "Beginner / Intermediate",
    1
  ),
  guide(
    "20000000-0000-4000-8000-000000000004",
    "10000000-0000-4000-8000-000000000002",
    "Crypto Market Cycles",
    "crypto-market-cycles",
    "Understand cycle phases, liquidity, sentiment, narratives, and the difference between trend and noise.",
    "Investing & Market Research",
    "Intermediate / Advanced",
    2
  ),
  guide(
    "20000000-0000-4000-8000-000000000005",
    "10000000-0000-4000-8000-000000000002",
    "Tokenomics & Project Research",
    "tokenomics-project-research",
    "Review supply, unlocks, incentives, users, revenue, governance, and the warning signs of weak projects.",
    "Investing & Market Research",
    "Intermediate / Advanced",
    3
  ),
  guide(
    "20000000-0000-4000-8000-000000000006",
    "10000000-0000-4000-8000-000000000003",
    "Trading Foundations: Charts, Orders & Market Structure",
    "trading-foundations-charts-orders-market-structure",
    "Build the chart-reading base for market structure, order types, levels, invalidation, and execution planning.",
    "Trading Academy",
    "Beginner / Intermediate",
    1,
    true
  ),
  guide(
    "20000000-0000-4000-8000-000000000007",
    "10000000-0000-4000-8000-000000000003",
    "Technical Analysis Masterclass",
    "technical-analysis-masterclass",
    "Study trend, levels, volume, confirmation, invalidation, and chart-reading discipline without hype.",
    "Trading Academy",
    "Intermediate / Advanced",
    2,
    true
  ),
  guide(
    "20000000-0000-4000-8000-000000000008",
    "10000000-0000-4000-8000-000000000003",
    "Risk Management Masterclass",
    "risk-management-masterclass",
    "Create rules for sizing, stops, daily loss limits, drawdowns, trade review, and capital preservation.",
    "Trading Academy",
    "Beginner / Intermediate / Advanced",
    3,
    true
  ),
  guide(
    "20000000-0000-4000-8000-000000000009",
    "10000000-0000-4000-8000-000000000003",
    "Futures Trading: Leverage, Liquidation & Strategy",
    "futures-trading-leverage-liquidation-strategy",
    "Learn margin modes, funding, liquidation risk, leverage limits, and futures planning before increasing exposure.",
    "Trading Academy",
    "Intermediate / Advanced",
    4,
    true
  ),
  guide(
    "20000000-0000-4000-8000-000000000010",
    "10000000-0000-4000-8000-000000000003",
    "Advanced Derivatives: Options & Margin",
    "advanced-derivatives-options-margin",
    "Explore options, margin, hedging, scenario planning, and structured derivatives concepts.",
    "Trading Academy",
    "Advanced / Expert",
    5,
    true
  ),
  guide(
    "20000000-0000-4000-8000-000000000011",
    "10000000-0000-4000-8000-000000000003",
    "Trading Psychology: Discipline Over Emotions",
    "trading-psychology-discipline-over-emotions",
    "Improve decision quality with patience, journaling, execution review, tilt control, and process consistency.",
    "Trading Academy",
    "Beginner / Intermediate / Advanced",
    6,
    true
  ),
  guide(
    "20000000-0000-4000-8000-000000000012",
    "10000000-0000-4000-8000-000000000004",
    "DeFi Fundamentals",
    "defi-fundamentals",
    "Learn the building blocks of decentralized exchanges, lending, liquidity, bridges, and protocol risk.",
    "DeFi & On-Chain Intelligence",
    "Intermediate / Advanced",
    1
  ),
  guide(
    "20000000-0000-4000-8000-000000000013",
    "10000000-0000-4000-8000-000000000004",
    "On-Chain Analysis",
    "on-chain-analysis",
    "Read wallet behavior, exchange flows, liquidity movements, holder cohorts, and on-chain market context.",
    "DeFi & On-Chain Intelligence",
    "Advanced / Expert",
    2
  ),
  guide(
    "20000000-0000-4000-8000-000000000014",
    "10000000-0000-4000-8000-000000000005",
    "Blockchain Development Basics",
    "blockchain-development-basics",
    "Start with blocks, transactions, smart contracts, gas, consensus, developer tooling, and contract safety.",
    "Blockchain Development",
    "Expert",
    1
  )
];

export const sampleCourses: Course[] = courseRows.map((course) => ({
  ...course,
  modules: [],
  guides: sampleGuides.filter((guideItem) => guideItem.course_id === course.id)
}));
