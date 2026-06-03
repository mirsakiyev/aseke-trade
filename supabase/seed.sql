insert into public.guides (
  id,
  title,
  slug,
  description,
  content,
  category,
  difficulty,
  estimated_read_time,
  is_premium
)
values
  (
    '11111111-1111-4111-8111-111111111111',
    'Crypto Basics: What Is Bitcoin?',
    'crypto-basics-what-is-bitcoin',
    'A plain-language introduction to Bitcoin, scarcity, decentralization, and why market participants treat it differently from traditional money.',
    'Bitcoin is a decentralized digital asset secured by a global network of computers. This guide covers wallets, scarcity, confirmations, and the difference between owning bitcoin directly and holding exposure through an exchange.',
    'Basics',
    'Beginner',
    7,
    false
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'How Wallets and Seed Phrases Work',
    'how-wallets-and-seed-phrases-work',
    'Learn how wallet addresses, private keys, and seed phrases work together, plus the security habits every beginner needs.',
    'A seed phrase is the recovery key to a crypto wallet. Anyone with it can control the assets. Store it offline, never type it into unknown websites, and test your backup process before moving meaningful funds.',
    'Wallets & Security',
    'Beginner',
    9,
    false
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'Spot Trading vs Futures Trading',
    'spot-trading-vs-futures-trading',
    'Understand the difference between buying an asset outright and using leveraged derivatives with liquidation risk.',
    'Spot trading means buying or selling the underlying asset. Futures trading uses contracts, margin, and leverage. Futures can amplify gains and losses, so risk controls matter before any entry signal.',
    'Futures Trading',
    'Beginner',
    8,
    false
  ),
  (
    '44444444-4444-4444-8444-444444444444',
    'Risk Management for Beginners',
    'risk-management-for-beginners',
    'Position sizing, stop placement, and trade journaling basics for protecting capital through uncertain markets.',
    'Risk management starts with defining invalidation before entering a trade. Keep risk per trade small, size positions from the stop distance, and review trades for repeatable process quality.',
    'Risk Management',
    'Beginner',
    10,
    false
  ),
  (
    '55555555-5555-4555-8555-555555555555',
    'Support and Resistance Strategy',
    'support-and-resistance-strategy',
    'A structured way to mark key levels, wait for confirmation, and avoid chasing candles after the move has already happened.',
    'Support and resistance levels are zones where market participants have previously reacted. A clean strategy uses context, confirmation, invalidation, and planned exits rather than blind level tapping.',
    'Trading Strategies',
    'Intermediate',
    12,
    true
  ),
  (
    '66666666-6666-4666-8666-666666666666',
    'Advanced Futures Trading Risk Control',
    'advanced-futures-trading-risk-control',
    'A premium guide to liquidation buffers, funding awareness, correlation exposure, and reducing leverage-related failure points.',
    'Advanced futures risk control combines leverage caps, liquidation distance, funding cost awareness, volatility-adjusted sizing, and correlation limits. The goal is to survive losing streaks with decision quality intact.',
    'Futures Trading',
    'Advanced',
    16,
    true
  ),
  (
    '77777777-7777-4777-8777-777777777777',
    'Scalping Strategy Basics',
    'scalping-strategy-basics',
    'A disciplined overview of fast intraday setups, execution rules, fees, spreads, and when to avoid low-quality trades.',
    'Scalping requires tight execution, clear invalidation, fee awareness, and emotional restraint. Fast trading does not remove risk; it compresses decision time and increases the cost of sloppy entries.',
    'Trading Strategies',
    'Intermediate',
    11,
    true
  ),
  (
    '88888888-8888-4888-8888-888888888888',
    'Swing Trading Strategy Basics',
    'swing-trading-strategy-basics',
    'Build a patient trading plan around trend context, higher-timeframe levels, risk per setup, and review cadence.',
    'Swing trading focuses on moves that unfold over days or weeks. The strongest plans combine market structure, risk control, planned exits, and enough patience to let the trade idea develop.',
    'Trading Strategies',
    'Intermediate',
    13,
    true
  )
on conflict (slug) do update set
  title = excluded.title,
  description = excluded.description,
  content = excluded.content,
  category = excluded.category,
  difficulty = excluded.difficulty,
  estimated_read_time = excluded.estimated_read_time,
  is_premium = excluded.is_premium,
  updated_at = now();

insert into public.courses (
  id,
  title,
  slug,
  description,
  difficulty,
  price_cents,
  is_premium
)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Crypto Foundations',
    'crypto-foundations',
    'A beginner-friendly course covering wallets, exchanges, spot markets, and the core safety habits needed before trading.',
    'Beginner',
    0,
    false
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'Advanced Futures Risk Control',
    'advanced-futures-risk-control',
    'A premium course for traders who want stricter leverage, liquidation, funding, and portfolio exposure controls.',
    'Advanced',
    14900,
    true
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'Strategy Lab',
    'strategy-lab',
    'Premium strategy modules for support and resistance, scalping, swing trading, trade journaling, and review.',
    'Intermediate',
    9900,
    true
  )
on conflict (slug) do update set
  title = excluded.title,
  description = excluded.description,
  difficulty = excluded.difficulty,
  price_cents = excluded.price_cents,
  is_premium = excluded.is_premium,
  updated_at = now();

insert into public.course_modules (id, course_id, title, sort_order)
values
  ('aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Market Basics', 1),
  ('bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Leverage Discipline', 1),
  ('cccccccc-1111-4ccc-8ccc-cccccccccccc', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Strategy Frameworks', 1)
on conflict (id) do update set
  course_id = excluded.course_id,
  title = excluded.title,
  sort_order = excluded.sort_order;

insert into public.lessons (
  id,
  module_id,
  title,
  content,
  sort_order,
  is_preview,
  is_premium
)
values
  (
    'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
    'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa',
    'What Crypto Markets Are',
    'Crypto markets run globally and around the clock. This lesson explains assets, trading pairs, exchanges, custody, and why preparation matters before placing trades.',
    1,
    true,
    false
  ),
  (
    'aaaaaaaa-1111-4222-8222-aaaaaaaaaaaa',
    'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa',
    'Wallet Safety Checklist',
    'Review seed phrase storage, device hygiene, withdrawal allowlists, and phishing prevention before you hold or move funds.',
    2,
    false,
    false
  ),
  (
    'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb',
    'bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb',
    'Free Preview: Futures Risk Map',
    'Preview the risk map used throughout the course: entry, invalidation, liquidation distance, funding, and maximum daily loss.',
    1,
    true,
    false
  ),
  (
    'bbbbbbbb-1111-4222-8222-bbbbbbbbbbbb',
    'bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb',
    'Liquidation Buffer Planning',
    'Calculate liquidation distance before position sizing. The aim is to keep leverage from defining the trade before the trade plan does.',
    2,
    false,
    true
  ),
  (
    'bbbbbbbb-1111-4333-8333-bbbbbbbbbbbb',
    'bbbbbbbb-1111-4bbb-8bbb-bbbbbbbbbbbb',
    'Funding and Correlation Exposure',
    'Monitor funding fees and correlated positions so multiple trades do not become one oversized market bet.',
    3,
    false,
    true
  ),
  (
    'cccccccc-1111-4111-8111-cccccccccccc',
    'cccccccc-1111-4ccc-8ccc-cccccccccccc',
    'Free Preview: From Setup to Plan',
    'A good setup becomes useful only when it includes context, entry criteria, invalidation, sizing, exits, and review notes.',
    1,
    true,
    false
  ),
  (
    'cccccccc-1111-4222-8222-cccccccccccc',
    'cccccccc-1111-4ccc-8ccc-cccccccccccc',
    'Support and Resistance Execution',
    'Plan around reaction zones, confirmation, and invalidation. Avoid treating a chart level as a guarantee.',
    2,
    false,
    true
  ),
  (
    'cccccccc-1111-4333-8333-cccccccccccc',
    'cccccccc-1111-4ccc-8ccc-cccccccccccc',
    'Scalping and Swing Review Loops',
    'Use separate review criteria for fast trades and multi-day trades so performance feedback stays honest.',
    3,
    false,
    true
  )
on conflict (id) do update set
  module_id = excluded.module_id,
  title = excluded.title,
  content = excluded.content,
  sort_order = excluded.sort_order,
  is_preview = excluded.is_preview,
  is_premium = excluded.is_premium,
  updated_at = now();
