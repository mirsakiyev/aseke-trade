import type { Course, Guide } from "../types/content";

const now = new Date("2026-06-03T12:00:00.000Z").toISOString();

export const sampleGuides: Guide[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Crypto Basics: What Is Bitcoin?",
    slug: "crypto-basics-what-is-bitcoin",
    description:
      "A plain-language introduction to Bitcoin, scarcity, decentralization, and why market participants treat it differently from traditional money.",
    content:
      "Bitcoin is a decentralized digital asset secured by a global network of computers. This guide covers wallets, scarcity, confirmations, and the difference between owning bitcoin directly and holding exposure through an exchange.",
    category: "Basics",
    difficulty: "Beginner",
    estimated_read_time: 7,
    is_premium: false,
    created_by: null,
    created_at: now,
    updated_at: now
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    title: "How Wallets and Seed Phrases Work",
    slug: "how-wallets-and-seed-phrases-work",
    description:
      "Learn how wallet addresses, private keys, and seed phrases work together, plus the security habits every beginner needs.",
    content:
      "A seed phrase is the recovery key to a crypto wallet. Anyone with it can control the assets. Store it offline, never type it into unknown websites, and test your backup process before moving meaningful funds.",
    category: "Wallets & Security",
    difficulty: "Beginner",
    estimated_read_time: 9,
    is_premium: false,
    created_by: null,
    created_at: now,
    updated_at: now
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    title: "Spot Trading vs Futures Trading",
    slug: "spot-trading-vs-futures-trading",
    description:
      "Understand the difference between buying an asset outright and using leveraged derivatives with liquidation risk.",
    content:
      "Spot trading means buying or selling the underlying asset. Futures trading uses contracts, margin, and leverage. Futures can amplify gains and losses, so risk controls matter before any entry signal.",
    category: "Futures Trading",
    difficulty: "Beginner",
    estimated_read_time: 8,
    is_premium: false,
    created_by: null,
    created_at: now,
    updated_at: now
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    title: "Risk Management for Beginners",
    slug: "risk-management-for-beginners",
    description:
      "Position sizing, stop placement, and trade journaling basics for protecting capital through uncertain markets.",
    content:
      "Risk management starts with defining invalidation before entering a trade. Keep risk per trade small, size positions from the stop distance, and review trades for repeatable process quality.",
    category: "Risk Management",
    difficulty: "Beginner",
    estimated_read_time: 10,
    is_premium: false,
    created_by: null,
    created_at: now,
    updated_at: now
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    title: "Support and Resistance Strategy",
    slug: "support-and-resistance-strategy",
    description:
      "A structured way to mark key levels, wait for confirmation, and avoid chasing candles after the move has already happened.",
    content:
      "Support and resistance levels are zones where market participants have previously reacted. A clean strategy uses context, confirmation, invalidation, and planned exits rather than blind level tapping.",
    category: "Trading Strategies",
    difficulty: "Intermediate",
    estimated_read_time: 12,
    is_premium: true,
    created_by: null,
    created_at: now,
    updated_at: now
  },
  {
    id: "66666666-6666-4666-8666-666666666666",
    title: "Advanced Futures Trading Risk Control",
    slug: "advanced-futures-trading-risk-control",
    description:
      "A premium guide to liquidation buffers, funding awareness, correlation exposure, and reducing leverage-related failure points.",
    content:
      "Advanced futures risk control combines leverage caps, liquidation distance, funding cost awareness, volatility-adjusted sizing, and correlation limits. The goal is to survive losing streaks with decision quality intact.",
    category: "Futures Trading",
    difficulty: "Advanced",
    estimated_read_time: 16,
    is_premium: true,
    created_by: null,
    created_at: now,
    updated_at: now
  },
  {
    id: "77777777-7777-4777-8777-777777777777",
    title: "Scalping Strategy Basics",
    slug: "scalping-strategy-basics",
    description:
      "A disciplined overview of fast intraday setups, execution rules, fees, spreads, and when to avoid low-quality trades.",
    content:
      "Scalping requires tight execution, clear invalidation, fee awareness, and emotional restraint. Fast trading does not remove risk; it compresses decision time and increases the cost of sloppy entries.",
    category: "Trading Strategies",
    difficulty: "Intermediate",
    estimated_read_time: 11,
    is_premium: true,
    created_by: null,
    created_at: now,
    updated_at: now
  },
  {
    id: "88888888-8888-4888-8888-888888888888",
    title: "Swing Trading Strategy Basics",
    slug: "swing-trading-strategy-basics",
    description:
      "Build a patient trading plan around trend context, higher-timeframe levels, risk per setup, and review cadence.",
    content:
      "Swing trading focuses on moves that unfold over days or weeks. The strongest plans combine market structure, risk control, planned exits, and enough patience to let the trade idea develop.",
    category: "Trading Strategies",
    difficulty: "Intermediate",
    estimated_read_time: 13,
    is_premium: true,
    created_by: null,
    created_at: now,
    updated_at: now
  }
];

export const sampleCourses: Course[] = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    title: "Crypto Foundations",
    slug: "crypto-foundations",
    description:
      "A beginner-friendly course covering wallets, exchanges, spot markets, and the core safety habits needed before trading.",
    difficulty: "Beginner",
    price_cents: 0,
    is_premium: false,
    created_at: now,
    updated_at: now,
    modules: [
      {
        id: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
        course_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "Market Basics",
        sort_order: 1,
        created_at: now,
        lessons: [
          {
            id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
            module_id: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
            title: "What Crypto Markets Are",
            content:
              "Crypto markets run globally and around the clock. This lesson explains assets, trading pairs, exchanges, custody, and why preparation matters before placing trades.",
            video_url: null,
            sort_order: 1,
            is_preview: true,
            is_premium: false,
            created_at: now,
            updated_at: now
          },
          {
            id: "aaaaaaaa-1111-4222-8222-aaaaaaaaaaaa",
            module_id: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
            title: "Wallet Safety Checklist",
            content:
              "Review seed phrase storage, device hygiene, withdrawal allowlists, and phishing prevention before you hold or move funds.",
            video_url: null,
            sort_order: 2,
            is_preview: false,
            is_premium: false,
            created_at: now,
            updated_at: now
          }
        ]
      }
    ]
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    title: "Advanced Futures Risk Control",
    slug: "advanced-futures-risk-control",
    description:
      "A premium course for traders who want stricter leverage, liquidation, funding, and portfolio exposure controls.",
    difficulty: "Advanced",
    price_cents: 14900,
    is_premium: true,
    created_at: now,
    updated_at: now,
    modules: [
      {
        id: "bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb",
        course_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        title: "Leverage Discipline",
        sort_order: 1,
        created_at: now,
        lessons: [
          {
            id: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb",
            module_id: "bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb",
            title: "Free Preview: Futures Risk Map",
            content:
              "Preview the risk map used throughout the course: entry, invalidation, liquidation distance, funding, and maximum daily loss.",
            video_url: null,
            sort_order: 1,
            is_preview: true,
            is_premium: false,
            created_at: now,
            updated_at: now
          },
          {
            id: "bbbbbbbb-1111-4222-8222-bbbbbbbbbbbb",
            module_id: "bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb",
            title: "Liquidation Buffer Planning",
            content:
              "Calculate liquidation distance before position sizing. The aim is to keep leverage from defining the trade before the trade plan does.",
            video_url: null,
            sort_order: 2,
            is_preview: false,
            is_premium: true,
            created_at: now,
            updated_at: now
          },
          {
            id: "bbbbbbbb-1111-4333-8333-bbbbbbbbbbbb",
            module_id: "bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb",
            title: "Funding and Correlation Exposure",
            content:
              "Monitor funding fees and correlated positions so multiple trades do not become one oversized market bet.",
            video_url: null,
            sort_order: 3,
            is_preview: false,
            is_premium: true,
            created_at: now,
            updated_at: now
          }
        ]
      }
    ]
  },
  {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    title: "Strategy Lab",
    slug: "strategy-lab",
    description:
      "Premium strategy modules for support and resistance, scalping, swing trading, trade journaling, and review.",
    difficulty: "Intermediate",
    price_cents: 9900,
    is_premium: true,
    created_at: now,
    updated_at: now,
    modules: [
      {
        id: "cccccccc-1111-4ccc-8ccc-cccccccccccc",
        course_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        title: "Strategy Frameworks",
        sort_order: 1,
        created_at: now,
        lessons: [
          {
            id: "cccccccc-1111-4111-8111-cccccccccccc",
            module_id: "cccccccc-1111-4ccc-8ccc-cccccccccccc",
            title: "Free Preview: From Setup to Plan",
            content:
              "A good setup becomes useful only when it includes context, entry criteria, invalidation, sizing, exits, and review notes.",
            video_url: null,
            sort_order: 1,
            is_preview: true,
            is_premium: false,
            created_at: now,
            updated_at: now
          },
          {
            id: "cccccccc-1111-4222-8222-cccccccccccc",
            module_id: "cccccccc-1111-4ccc-8ccc-cccccccccccc",
            title: "Support and Resistance Execution",
            content:
              "Plan around reaction zones, confirmation, and invalidation. Avoid treating a chart level as a guarantee.",
            video_url: null,
            sort_order: 2,
            is_preview: false,
            is_premium: true,
            created_at: now,
            updated_at: now
          },
          {
            id: "cccccccc-1111-4333-8333-cccccccccccc",
            module_id: "cccccccc-1111-4ccc-8ccc-cccccccccccc",
            title: "Scalping and Swing Review Loops",
            content:
              "Use separate review criteria for fast trades and multi-day trades so performance feedback stays honest.",
            video_url: null,
            sort_order: 3,
            is_preview: false,
            is_premium: true,
            created_at: now,
            updated_at: now
          }
        ]
      }
    ]
  }
];
