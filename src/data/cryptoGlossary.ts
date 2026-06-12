export interface GlossaryTerm {
  term: string;
  definition: string;
  tags: string[];
}

export interface GlossaryCategory {
  title: string;
  description: string;
  terms: GlossaryTerm[];
}

export const cryptoGlossaryCategories: GlossaryCategory[] = [
  {
    title: "Basics",
    description: "Core words used across crypto education, wallets, exchanges, and market research.",
    terms: [
      {
        term: "Bitcoin",
        definition: "The first decentralized cryptocurrency, designed as peer-to-peer digital money with a fixed supply schedule.",
        tags: ["BTC", "network", "store of value"]
      },
      {
        term: "Ethereum",
        definition: "A programmable blockchain used for smart contracts, tokens, decentralized apps, NFTs, and DeFi protocols.",
        tags: ["ETH", "smart contracts", "network"]
      },
      {
        term: "Altcoin",
        definition: "Any crypto asset other than Bitcoin. The term is broad and can include large networks, tokens, and speculative assets.",
        tags: ["market", "asset"]
      },
      {
        term: "Stablecoin",
        definition: "A token designed to track the value of another asset, usually a fiat currency such as the U.S. dollar.",
        tags: ["USDT", "USDC", "payments"]
      },
      {
        term: "Coin",
        definition: "A crypto asset native to its own blockchain, such as BTC on Bitcoin or ETH on Ethereum.",
        tags: ["asset", "native"]
      },
      {
        term: "Token",
        definition: "A crypto asset issued on an existing blockchain, often used for governance, utility, rewards, or access.",
        tags: ["asset", "smart contracts"]
      },
      {
        term: "Wallet",
        definition: "Software or hardware that manages keys and lets a user receive, hold, and send crypto assets.",
        tags: ["keys", "storage"]
      },
      {
        term: "Private Key",
        definition: "A secret cryptographic key that controls access to funds. Anyone with it can move the associated assets.",
        tags: ["security", "wallet"]
      },
      {
        term: "Seed Phrase",
        definition: "A recovery phrase used to restore a wallet. It must be stored privately and never entered into untrusted websites.",
        tags: ["backup", "wallet"]
      },
      {
        term: "Exchange",
        definition: "A platform where users buy, sell, or trade crypto assets. Exchanges may be centralized or decentralized.",
        tags: ["trading", "platform"]
      },
      {
        term: "Market Cap",
        definition: "A rough asset valuation calculated by multiplying current price by circulating supply.",
        tags: ["valuation", "research"]
      },
      {
        term: "Volatility",
        definition: "The degree of price movement over time. Higher volatility means larger and faster price swings.",
        tags: ["risk", "price"]
      }
    ]
  },
  {
    title: "Trading",
    description: "Terms used when reading charts, planning entries, managing positions, and controlling risk.",
    terms: [
      {
        term: "Spot Trading",
        definition: "Buying or selling the actual asset at the current market price or through a limit order.",
        tags: ["markets", "exchange"]
      },
      {
        term: "Futures",
        definition: "Derivative contracts that track an asset price and allow long or short exposure without owning the asset.",
        tags: ["derivatives", "leverage"]
      },
      {
        term: "Leverage",
        definition: "Borrowed exposure that magnifies gains and losses. Higher leverage reduces the distance to liquidation.",
        tags: ["risk", "futures"]
      },
      {
        term: "Liquidation",
        definition: "Forced closure of a leveraged position when margin is no longer enough to support the trade.",
        tags: ["risk", "margin"]
      },
      {
        term: "Margin",
        definition: "Collateral posted to open or maintain a leveraged position.",
        tags: ["leverage", "collateral"]
      },
      {
        term: "Funding Rate",
        definition: "A periodic payment between long and short futures traders that helps keep perpetual contracts near spot price.",
        tags: ["futures", "perpetuals"]
      },
      {
        term: "Stop Loss",
        definition: "A planned exit level intended to limit downside when a trade moves against the setup.",
        tags: ["risk", "exit"]
      },
      {
        term: "Take Profit",
        definition: "A planned exit level intended to lock in gains when price reaches a target.",
        tags: ["risk", "exit"]
      },
      {
        term: "Support",
        definition: "A price area where buyers have previously stepped in or where demand may appear.",
        tags: ["charts", "technical analysis"]
      },
      {
        term: "Resistance",
        definition: "A price area where sellers have previously stepped in or where supply may appear.",
        tags: ["charts", "technical analysis"]
      },
      {
        term: "Slippage",
        definition: "The difference between expected execution price and actual execution price, often worse during fast markets.",
        tags: ["execution", "liquidity"]
      },
      {
        term: "Order Book",
        definition: "A live list of buy and sell orders resting at different prices on an exchange.",
        tags: ["liquidity", "exchange"]
      },
      {
        term: "Risk to Reward",
        definition: "A comparison between the amount risked on a trade and the potential reward if the target is reached.",
        tags: ["planning", "risk"]
      },
      {
        term: "Bull Market",
        definition: "A market environment where price trends broadly upward and risk appetite is strong.",
        tags: ["cycle", "trend"]
      },
      {
        term: "Bear Market",
        definition: "A market environment where price trends broadly downward and risk appetite is weak.",
        tags: ["cycle", "trend"]
      }
    ]
  },
  {
    title: "Blockchain and DeFi",
    description: "Infrastructure and protocol terms behind on-chain activity, decentralized apps, and liquidity.",
    terms: [
      {
        term: "Blockchain",
        definition: "A shared ledger made of ordered blocks of transactions that are verified by a network.",
        tags: ["ledger", "network"]
      },
      {
        term: "Block",
        definition: "A batch of transactions added to a blockchain after validation.",
        tags: ["ledger", "transactions"]
      },
      {
        term: "Smart Contract",
        definition: "Code deployed on a blockchain that can hold assets and execute rules without a traditional intermediary.",
        tags: ["Ethereum", "automation"]
      },
      {
        term: "DeFi",
        definition: "Decentralized finance: financial applications built with smart contracts, such as lending, swaps, and liquidity pools.",
        tags: ["protocols", "finance"]
      },
      {
        term: "DEX",
        definition: "A decentralized exchange where users trade through smart contracts instead of a centralized order-matching platform.",
        tags: ["DeFi", "swap"]
      },
      {
        term: "Liquidity Pool",
        definition: "A smart contract holding assets supplied by users so others can trade or borrow against them.",
        tags: ["DeFi", "liquidity"]
      },
      {
        term: "AMM",
        definition: "Automated market maker: a system that prices trades against a liquidity pool using an algorithm.",
        tags: ["DEX", "liquidity"]
      },
      {
        term: "Yield Farming",
        definition: "Moving assets through protocols to earn incentives, fees, or token rewards. It can carry high smart contract risk.",
        tags: ["DeFi", "rewards"]
      },
      {
        term: "Staking",
        definition: "Locking or delegating tokens to help secure a proof-of-stake network or earn protocol rewards.",
        tags: ["validators", "rewards"]
      },
      {
        term: "Gas Fee",
        definition: "The transaction fee paid to use a blockchain network, especially for smart contract execution.",
        tags: ["fees", "Ethereum"]
      },
      {
        term: "Layer 2",
        definition: "A scaling network that settles back to a base blockchain while offering cheaper or faster transactions.",
        tags: ["scaling", "rollups"]
      },
      {
        term: "Bridge",
        definition: "A tool or protocol used to move assets or messages between blockchains.",
        tags: ["cross-chain", "risk"]
      },
      {
        term: "Oracle",
        definition: "A service that brings off-chain data, such as prices, into smart contracts.",
        tags: ["data", "DeFi"]
      }
    ]
  },
  {
    title: "Risk and Security",
    description: "Safety terms for custody, account protection, transaction hygiene, and platform risk.",
    terms: [
      {
        term: "Cold Wallet",
        definition: "A wallet setup that keeps private keys offline, reducing exposure to online attacks.",
        tags: ["storage", "security"]
      },
      {
        term: "Hot Wallet",
        definition: "A wallet connected to the internet. It is convenient but more exposed than cold storage.",
        tags: ["storage", "security"]
      },
      {
        term: "Phishing",
        definition: "A scam that tricks users into revealing passwords, seed phrases, private keys, or signing harmful transactions.",
        tags: ["scam", "wallet"]
      },
      {
        term: "Rug Pull",
        definition: "A scam where project insiders remove liquidity, abandon promises, or otherwise leave buyers with severe losses.",
        tags: ["scam", "tokens"]
      },
      {
        term: "Audit",
        definition: "A security review of code or systems. It reduces risk but does not guarantee safety.",
        tags: ["security", "smart contracts"]
      },
      {
        term: "Custody",
        definition: "Control over private keys or assets. Self-custody means the user controls keys directly.",
        tags: ["wallet", "exchange"]
      },
      {
        term: "Two-Factor Authentication",
        definition: "An account protection method requiring a second verification step beyond a password.",
        tags: ["account", "security"]
      },
      {
        term: "Revoke Approval",
        definition: "Removing a smart contract's permission to spend tokens from a wallet.",
        tags: ["wallet", "permissions"]
      },
      {
        term: "Dirty Crypto",
        definition: "Crypto linked to hacks, scams, sanctions, theft, or other illicit activity that can create compliance and account risk.",
        tags: ["compliance", "risk"]
      },
      {
        term: "KYC",
        definition: "Know Your Customer checks used by platforms to verify identity and meet compliance requirements.",
        tags: ["compliance", "exchange"]
      },
      {
        term: "AML",
        definition: "Anti-money laundering controls intended to detect or prevent illicit financial activity.",
        tags: ["compliance", "risk"]
      }
    ]
  },
  {
    title: "Advanced Concepts",
    description: "Research vocabulary for network design, supply analysis, validation, and on-chain market structure.",
    terms: [
      {
        term: "MEV",
        definition: "Maximal extractable value: profit captured by ordering, inserting, or excluding transactions in a block.",
        tags: ["validators", "DeFi"]
      },
      {
        term: "Halving",
        definition: "A scheduled reduction in new Bitcoin issuance that happens roughly every four years.",
        tags: ["Bitcoin", "supply"]
      },
      {
        term: "Tokenomics",
        definition: "The design of a token's supply, incentives, unlocks, utility, and distribution.",
        tags: ["research", "supply"]
      },
      {
        term: "Circulating Supply",
        definition: "The amount of an asset currently available in the market, excluding some locked or unissued supply.",
        tags: ["supply", "valuation"]
      },
      {
        term: "Fully Diluted Valuation",
        definition: "A valuation estimate using current price multiplied by maximum or total possible token supply.",
        tags: ["FDV", "valuation"]
      },
      {
        term: "Hash Rate",
        definition: "The combined computing power securing a proof-of-work network.",
        tags: ["mining", "security"]
      },
      {
        term: "Consensus",
        definition: "The process a blockchain network uses to agree on valid transactions and ledger state.",
        tags: ["network", "validation"]
      },
      {
        term: "Proof of Work",
        definition: "A consensus method where miners spend computational energy to propose blocks and secure the network.",
        tags: ["mining", "Bitcoin"]
      },
      {
        term: "Proof of Stake",
        definition: "A consensus method where validators stake tokens to propose or attest to blocks.",
        tags: ["validators", "staking"]
      },
      {
        term: "Validator",
        definition: "A network participant that helps confirm transactions and produce blocks, often by staking tokens.",
        tags: ["consensus", "staking"]
      },
      {
        term: "Rollup",
        definition: "A scaling system that processes transactions off the base chain and posts proofs or data back to it.",
        tags: ["Layer 2", "scaling"]
      },
      {
        term: "Airdrop",
        definition: "A distribution of tokens to wallets, often based on eligibility rules or previous on-chain activity.",
        tags: ["tokens", "distribution"]
      },
      {
        term: "Governance Token",
        definition: "A token that may allow holders to vote on protocol changes, treasury use, or parameter updates.",
        tags: ["DAO", "voting"]
      }
    ]
  }
];
