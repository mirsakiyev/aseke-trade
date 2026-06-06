alter table public.courses
add column if not exists sort_order integer not null default 1;

alter table public.courses
add column if not exists is_archived boolean not null default false;

alter table public.guides
add column if not exists course_id uuid;

alter table public.guides
add column if not exists sort_order integer not null default 1;

alter table public.guides
add column if not exists is_archived boolean not null default false;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'guides_course_id_fkey'
      and conrelid = 'public.guides'::regclass
  ) then
    alter table public.guides
    add constraint guides_course_id_fkey
    foreign key (course_id) references public.courses(id) on delete set null;
  end if;
end $$;

alter table public.guides
drop constraint if exists guides_category_check;

alter table public.guides
add constraint guides_category_check
check (
  category in (
    'Crypto Basics',
    'Investing & Market Research',
    'Trading Academy',
    'DeFi & On-Chain Intelligence',
    'Blockchain Development',
    'Basics',
    'Wallets & Security',
    'Spot Trading',
    'Futures Trading',
    'Risk Management',
    'Trading Strategies',
    'Advanced Concepts'
  )
);

alter table public.guides
drop constraint if exists guides_difficulty_check;

alter table public.guides
add constraint guides_difficulty_check
check (
  difficulty in (
    'Beginner',
    'Intermediate',
    'Advanced',
    'Expert',
    'Beginner / Intermediate',
    'Intermediate / Advanced',
    'Advanced / Expert',
    'Beginner / Intermediate / Advanced'
  )
);

alter table public.courses
drop constraint if exists courses_difficulty_check;

alter table public.courses
add constraint courses_difficulty_check
check (difficulty in ('Beginner', 'Intermediate', 'Advanced', 'Expert'));

create index if not exists courses_sort_order_idx on public.courses(sort_order);
create index if not exists courses_is_archived_idx on public.courses(is_archived);
create index if not exists guides_course_id_idx on public.guides(course_id);
create index if not exists guides_sort_order_idx on public.guides(sort_order);
create index if not exists guides_is_archived_idx on public.guides(is_archived);

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
    19900,
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
    'Trading Foundations: Spot, Margin & Futures',
    'trading-foundations-spot-margin-futures',
    'Compare spot, margin, and futures markets before learning technical setups or leverage-based execution.',
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
    'Futures Trading & Leverage',
    'futures-trading-leverage',
    'Learn liquidation risk, margin modes, funding, leverage limits, and how futures can amplify mistakes.',
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
    'Advanced Derivatives & Strategy',
    'advanced-derivatives-strategy',
    'Explore advanced derivatives concepts, hedging, scenario planning, and structured trading frameworks.',
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
    'Trading Psychology & Execution',
    'trading-psychology-execution',
    'Improve decision quality around patience, journaling, execution errors, tilt, and process consistency.',
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
  'trading-foundations-spot-margin-futures',
  'technical-analysis-masterclass',
  'risk-management-masterclass',
  'futures-trading-leverage',
  'advanced-derivatives-strategy',
  'trading-psychology-execution',
  'defi-fundamentals',
  'on-chain-analysis',
  'blockchain-development-basics'
)
and is_archived = false;

create or replace function public.can_access_course(target_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or public.has_premium_access()
    or public.has_course_purchase(target_course_id)
    or exists (
      select 1
      from public.courses
      where id = target_course_id
        and is_archived = false
        and is_premium = false
    );
$$;

create or replace function public.can_access_guide(target_guide_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin()
    or public.has_premium_access()
    or public.has_guide_purchase(target_guide_id)
    or exists (
      select 1
      from public.guides
      where id = target_guide_id
        and course_id is not null
        and public.has_course_purchase(course_id)
    )
    or exists (
      select 1
      from public.guides g
      left join public.courses c on c.id = g.course_id
      where g.id = target_guide_id
        and g.is_archived = false
        and g.is_premium = false
        and coalesce(c.is_premium, false) = false
    );
$$;

create or replace function public.can_access_lesson(target_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lessons l
    join public.course_modules m on m.id = l.module_id
    join public.courses c on c.id = m.course_id
    where l.id = target_lesson_id
      and c.is_archived = false
      and (
        l.is_preview = true
        or l.is_premium = false
        or c.is_premium = false
        or public.can_access_course(c.id)
      )
  );
$$;

drop policy if exists "guides_select_by_access" on public.guides;
drop policy if exists "guides_select_catalog_metadata" on public.guides;
create policy "guides_select_catalog_metadata"
on public.guides for select
using (is_archived = false or public.is_admin());

drop policy if exists "courses_select_catalog_metadata" on public.courses;
create policy "courses_select_catalog_metadata"
on public.courses for select
using (is_archived = false or public.is_admin());

drop policy if exists "course_modules_select_catalog_metadata" on public.course_modules;
create policy "course_modules_select_catalog_metadata"
on public.course_modules for select
using (
  public.is_admin()
  or exists (
    select 1
    from public.courses
    where id = course_id
      and is_archived = false
  )
);

notify pgrst, 'reload schema';
