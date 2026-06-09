insert into public.courses (
  id,
  title,
  slug,
  description,
  difficulty,
  price_cents,
  is_premium,
  is_archived,
  sort_order
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'Crypto Basics',
    'crypto-basics',
    'A beginner path covering what crypto is, how wallets work, and the security habits needed before moving capital.',
    'Beginner',
    0,
    false,
    false,
    1
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'Investing & Market Research',
    'investing-market-research',
    'Build a research process for portfolio construction, market cycles, tokenomics, narratives, and project quality.',
    'Intermediate',
    0,
    false,
    false,
    2
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'Trading Academy',
    'trading-academy',
    'The premium trading path for technical analysis, risk control, futures, derivatives, psychology, and execution.',
    'Advanced',
    0,
    true,
    false,
    3
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    'DeFi & On-Chain Intelligence',
    'defi-on-chain-intelligence',
    'Understand decentralized finance, on-chain behavior, wallet flows, liquidity, and market structure signals.',
    'Advanced',
    0,
    false,
    false,
    4
  ),
  (
    '10000000-0000-4000-8000-000000000005',
    'Blockchain Development',
    'blockchain-development',
    'An expert path for learners who want to understand blockchain architecture, smart contracts, and developer concepts.',
    'Expert',
    0,
    false,
    false,
    5
  )
on conflict (slug) do update set
  title = excluded.title,
  description = excluded.description,
  difficulty = excluded.difficulty,
  price_cents = excluded.price_cents,
  is_premium = excluded.is_premium,
  is_archived = excluded.is_archived,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.guides (
  id,
  course_id,
  title,
  slug,
  description,
  content,
  category,
  difficulty,
  estimated_read_time,
  is_premium,
  is_archived,
  sort_order
)
values
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Crypto Foundations',
    'crypto-foundations',
    'Learn the core ideas behind Bitcoin, crypto assets, blockchains, exchanges, wallets, and self-custody.',
    'Coming soon.',
    'Crypto Basics',
    'Beginner',
    8,
    false,
    false,
    1
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'Crypto Safety & Security',
    'crypto-safety-security',
    'Build safer habits around seed phrases, account protection, exchange security, withdrawals, and phishing risk.',
    'Coming soon.',
    'Crypto Basics',
    'Beginner / Intermediate',
    8,
    false,
    false,
    2
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000002',
    'Portfolio Building & Investing',
    'portfolio-building-investing',
    'Create a simple framework for allocation, position sizing, long-term conviction, and risk-aware investing.',
    'Coming soon.',
    'Investing & Market Research',
    'Beginner / Intermediate',
    8,
    false,
    false,
    1
  ),
  (
    '20000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000002',
    'Crypto Market Cycles',
    'crypto-market-cycles',
    'Understand cycle phases, liquidity, sentiment, narratives, and the difference between trend and noise.',
    'Coming soon.',
    'Investing & Market Research',
    'Intermediate / Advanced',
    8,
    false,
    false,
    2
  ),
  (
    '20000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000002',
    'Tokenomics & Project Research',
    'tokenomics-project-research',
    'Review supply, unlocks, incentives, users, revenue, governance, and the warning signs of weak projects.',
    'Coming soon.',
    'Investing & Market Research',
    'Intermediate / Advanced',
    8,
    false,
    false,
    3
  ),
  (
    '20000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000003',
    'Trading Foundations: Charts, Orders & Market Structure',
    'trading-foundations-charts-orders-market-structure',
    'Build the chart-reading foundation for market structure, order types, levels, and execution planning.',
    'Coming soon.',
    'Trading Academy',
    'Beginner / Intermediate',
    8,
    true,
    false,
    1
  ),
  (
    '20000000-0000-4000-8000-000000000007',
    '10000000-0000-4000-8000-000000000003',
    'Technical Analysis Masterclass',
    'technical-analysis-masterclass',
    'Study market structure, trend, levels, volume, confirmation, invalidation, and chart-reading discipline.',
    'Coming soon.',
    'Trading Academy',
    'Intermediate / Advanced',
    8,
    true,
    false,
    2
  ),
  (
    '20000000-0000-4000-8000-000000000008',
    '10000000-0000-4000-8000-000000000003',
    'Risk Management Masterclass',
    'risk-management-masterclass',
    'Create rules for sizing, stops, daily loss limits, drawdowns, trade review, and capital preservation.',
    'Coming soon.',
    'Trading Academy',
    'Beginner / Intermediate / Advanced',
    8,
    true,
    false,
    3
  ),
  (
    '20000000-0000-4000-8000-000000000009',
    '10000000-0000-4000-8000-000000000003',
    'Futures Trading: Leverage, Liquidation & Strategy',
    'futures-trading-leverage-liquidation-strategy',
    'Learn liquidation risk, margin modes, funding, leverage limits, and safer futures strategy planning.',
    'Coming soon.',
    'Trading Academy',
    'Intermediate / Advanced',
    8,
    true,
    false,
    4
  ),
  (
    '20000000-0000-4000-8000-000000000010',
    '10000000-0000-4000-8000-000000000003',
    'Advanced Derivatives: Options & Margin',
    'advanced-derivatives-options-margin',
    'Explore options, margin, hedging, scenario planning, and structured derivatives concepts.',
    'Coming soon.',
    'Trading Academy',
    'Advanced / Expert',
    8,
    true,
    false,
    5
  ),
  (
    '20000000-0000-4000-8000-000000000011',
    '10000000-0000-4000-8000-000000000003',
    'Trading Psychology: Discipline Over Emotions',
    'trading-psychology-discipline-over-emotions',
    'Improve decision quality around patience, journaling, execution mistakes, tilt, and process consistency.',
    'Coming soon.',
    'Trading Academy',
    'Beginner / Intermediate / Advanced',
    8,
    true,
    false,
    6
  ),
  (
    '20000000-0000-4000-8000-000000000012',
    '10000000-0000-4000-8000-000000000004',
    'DeFi Fundamentals',
    'defi-fundamentals',
    'Learn the building blocks of decentralized exchanges, lending, liquidity, bridges, and protocol risk.',
    'Coming soon.',
    'DeFi & On-Chain Intelligence',
    'Intermediate / Advanced',
    8,
    false,
    false,
    1
  ),
  (
    '20000000-0000-4000-8000-000000000013',
    '10000000-0000-4000-8000-000000000004',
    'On-Chain Analysis',
    'on-chain-analysis',
    'Read wallet behavior, exchange flows, liquidity movements, holder cohorts, and on-chain market signals.',
    'Coming soon.',
    'DeFi & On-Chain Intelligence',
    'Advanced / Expert',
    8,
    false,
    false,
    2
  ),
  (
    '20000000-0000-4000-8000-000000000014',
    '10000000-0000-4000-8000-000000000005',
    'Blockchain Development Basics',
    'blockchain-development-basics',
    'Start with blocks, transactions, smart contracts, gas, consensus, developer tooling, and contract safety.',
    'Coming soon.',
    'Blockchain Development',
    'Expert',
    8,
    false,
    false,
    1
  )
on conflict (slug) do update set
  course_id = excluded.course_id,
  title = excluded.title,
  description = excluded.description,
  content = excluded.content,
  category = excluded.category,
  difficulty = excluded.difficulty,
  estimated_read_time = excluded.estimated_read_time,
  is_premium = excluded.is_premium,
  is_archived = excluded.is_archived,
  sort_order = excluded.sort_order,
  updated_at = now();

update public.courses
set is_archived = true,
    updated_at = now()
where slug not in (
  'crypto-basics',
  'investing-market-research',
  'trading-academy',
  'defi-on-chain-intelligence',
  'blockchain-development'
)
and is_archived = false;

update public.guides
set is_archived = true,
    updated_at = now()
where slug not in (
  'crypto-foundations',
  'crypto-safety-security',
  'portfolio-building-investing',
  'crypto-market-cycles',
  'tokenomics-project-research',
  'trading-foundations-charts-orders-market-structure',
  'technical-analysis-masterclass',
  'risk-management-masterclass',
  'futures-trading-leverage-liquidation-strategy',
  'advanced-derivatives-options-margin',
  'trading-psychology-discipline-over-emotions',
  'defi-fundamentals',
  'on-chain-analysis',
  'blockchain-development-basics'
)
and is_archived = false;

update public.guides
set price_cents = 0,
    updated_at = now()
where is_premium = true
  and price_cents = 0;

notify pgrst, 'reload schema';
