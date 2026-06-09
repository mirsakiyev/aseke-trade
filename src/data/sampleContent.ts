import type { Course, CourseDifficulty, Difficulty, Guide, GuideCategory } from "../types/content";

const now = new Date("2026-06-05T12:00:00.000Z").toISOString();

const courseRows = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    title: "Crypto Basics",
    slug: "crypto-basics",
    description:
      "A beginner path covering what crypto is, how wallets work, and the security habits needed before moving capital.",
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
      "Build a research process for portfolio construction, market cycles, tokenomics, narratives, and project quality.",
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
      "The premium trading path for technical analysis, risk control, futures, derivatives, psychology, and execution.",
    difficulty: "Advanced" as CourseDifficulty,
    price_cents: 19900,
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
      "Understand decentralized finance, on-chain behavior, wallet flows, liquidity, and market structure signals.",
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
      "An expert path for learners who want to understand blockchain architecture, smart contracts, and developer concepts.",
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
    price_cents: is_premium ? 4900 : 0,
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
    "Learn the core ideas behind Bitcoin, crypto assets, blockchains, exchanges, wallets, and self-custody.",
    "Crypto Basics",
    "Beginner",
    1
  ),
  guide(
    "20000000-0000-4000-8000-000000000002",
    "10000000-0000-4000-8000-000000000001",
    "Crypto Safety & Security",
    "crypto-safety-security",
    "Build safer habits around seed phrases, account protection, exchange security, withdrawals, and phishing risk.",
    "Crypto Basics",
    "Beginner / Intermediate",
    2
  ),
  guide(
    "20000000-0000-4000-8000-000000000003",
    "10000000-0000-4000-8000-000000000002",
    "Portfolio Building & Investing",
    "portfolio-building-investing",
    "Create a simple framework for allocation, position sizing, long-term conviction, and risk-aware investing.",
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
    "Trading Foundations: Spot, Margin & Futures",
    "trading-foundations-spot-margin-futures",
    "Compare spot, margin, and futures markets before learning technical setups or leverage-based execution.",
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
    "Study market structure, trend, levels, volume, confirmation, invalidation, and chart-reading discipline.",
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
    "Futures Trading & Leverage",
    "futures-trading-leverage",
    "Learn liquidation risk, margin modes, funding, leverage limits, and how futures can amplify mistakes.",
    "Trading Academy",
    "Intermediate / Advanced",
    4,
    true
  ),
  guide(
    "20000000-0000-4000-8000-000000000010",
    "10000000-0000-4000-8000-000000000003",
    "Advanced Derivatives & Strategy",
    "advanced-derivatives-strategy",
    "Explore advanced derivatives concepts, hedging, scenario planning, and structured trading frameworks.",
    "Trading Academy",
    "Advanced / Expert",
    5,
    true
  ),
  guide(
    "20000000-0000-4000-8000-000000000011",
    "10000000-0000-4000-8000-000000000003",
    "Trading Psychology & Execution",
    "trading-psychology-execution",
    "Improve decision quality around patience, journaling, execution errors, tilt, and process consistency.",
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
    "Read wallet behavior, exchange flows, liquidity movements, holder cohorts, and on-chain market signals.",
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
