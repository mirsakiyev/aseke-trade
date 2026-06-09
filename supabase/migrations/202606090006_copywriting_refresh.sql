update public.courses
set description = case slug
  when 'crypto-basics' then 'Start from zero. Learn crypto, blockchain, wallets, exchanges, and safe self-custody before risking real capital.'
  when 'investing-market-research' then 'Learn project research, tokenomics, market cycles, and stronger market judgment before entering trades.'
  when 'trading-academy' then 'Premium trading education for market structure, technical analysis, risk, psychology, futures, derivatives, and strategy.'
  when 'defi-on-chain-intelligence' then 'Learn how DeFi works and how on-chain data can support stronger market awareness and trading context.'
  when 'blockchain-development' then 'A builder-focused introduction to blockchain concepts, smart contracts, and development fundamentals.'
  else description
end,
updated_at = now()
where slug in (
  'crypto-basics',
  'investing-market-research',
  'trading-academy',
  'defi-on-chain-intelligence',
  'blockchain-development'
);

update public.guides
set description = case slug
  when 'crypto-foundations' then 'Build the foundation for Bitcoin, crypto assets, wallets, exchanges, transactions, and self-custody.'
  when 'crypto-safety-security' then 'Protect your learning journey with seed phrase safety, account protection, exchange security, and phishing awareness.'
  when 'portfolio-building-investing' then 'Create a risk-aware framework for allocation, position sizing, conviction, and long-term market exposure.'
  when 'trading-foundations-charts-orders-market-structure' then 'Build the chart-reading base for market structure, order types, levels, invalidation, and execution planning.'
  when 'technical-analysis-masterclass' then 'Study trend, levels, volume, confirmation, invalidation, and chart-reading discipline without hype.'
  when 'futures-trading-leverage-liquidation-strategy' then 'Learn margin modes, funding, liquidation risk, leverage limits, and futures planning before increasing exposure.'
  when 'trading-psychology-discipline-over-emotions' then 'Improve decision quality with patience, journaling, execution review, tilt control, and process consistency.'
  when 'on-chain-analysis' then 'Read wallet behavior, exchange flows, liquidity movements, holder cohorts, and on-chain market context.'
  else description
end,
updated_at = now()
where slug in (
  'crypto-foundations',
  'crypto-safety-security',
  'portfolio-building-investing',
  'trading-foundations-charts-orders-market-structure',
  'technical-analysis-masterclass',
  'futures-trading-leverage-liquidation-strategy',
  'trading-psychology-discipline-over-emotions',
  'on-chain-analysis'
);
