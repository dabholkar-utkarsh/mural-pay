import type { CompanyFilters, SignalKey } from "./types";

export const DEFAULT_COMPANY_LIMIT = 10;
export const MAX_COMPANY_LIMIT = 100;
// 100 = Apollo's max page size; the whole candidate pool fits in one call.
export const APOLLO_PER_PAGE = 100;

// Over-fetch so we can re-rank and return the best N, not the first N.
export const OVERFETCH_MULTIPLIER = 5;
export const MAX_SEARCH_PAGES = 4;

// Only the top-ranked candidates get a people-search verification call.
export const PEOPLE_CHECK_COUNT = 20;

// The search endpoint returns a slim payload (no employee count, keywords,
// industry, or location), so candidates are enriched before scoring.
// Each bulk enrichment call covers 10 domains and consumes credits.
// Enrich limit x multiplier candidates (so the scorer has options), capped.
export const ENRICH_MULTIPLIER = 2;
export const ENRICH_MAX = 20;
export const ENRICH_BATCH_SIZE = 10;

// Curated keyword clusters per ICP chip, validated against live Apollo
// searches (e.g. the prediction-market set surfaces Kalshi/Polymarket as the
// top results). Apollo ORs the tags, so each cluster stays tight — loose
// single-word tags like "betting" or "marketplace" pull agencies, media,
// and venues. Bare chip names are intentionally NOT included as tags.
// Whop-like creator platforms live under "marketplace"; Kalshi-like
// prediction markets live under "betting".
export const KEYWORD_SYNONYMS: Record<string, string[]> = {
  payroll: [
    "payroll software",
    "payroll processing",
    "online payroll",
    "global payroll",
    "payroll compliance",
    "employer of record",
    "contractor payments",
    "contractor management",
    "hris",
    "benefits administration",
    "human capital management",
  ],
  "e-com": [
    "ecommerce platform",
    "e-commerce platform",
    "commerce platform",
    "digital commerce",
    "online store",
    "online retail",
    "checkout",
    "subscription commerce",
    "headless commerce",
    "direct to consumer",
    "retail technology",
  ],
  marketplace: [
    "online marketplace",
    "marketplace platform",
    "marketplace payments",
    "creator marketplace",
    "digital product marketplace",
    "paid community",
    "membership platform",
    "subscription platform",
    "creator monetization",
    "social commerce",
    "creator economy",
  ],
  betting: [
    "prediction markets",
    "event contracts",
    "event trading",
    "sports event contracts",
    "derivatives exchange",
    "betting exchange",
    "sportsbook",
    "sports betting platform",
    "sports wagering",
    "igaming",
    "online gambling",
    "daily fantasy sports",
  ],
};

// Buyer personas are verified via people search, not the company search.
export const BUYER_TITLE_EXPANSIONS: Record<string, string[]> = {
  CPO: ["chief product officer"],
  CLO: ["chief legal officer"],
  CFO: ["chief financial officer"],
};

// Roles that signal ICP pain when a company is actively hiring for them.
// Sent to Apollo as q_organization_job_titles (active job postings).
export const HIRING_TITLE_OPTIONS = [
  "payroll specialist",
  "payments operations",
  "compliance officer",
  "treasury analyst",
];

// Composite scoring: filters are worth 50 points total (10 per active
// filter, normalized), the AI judgment is worth the other 50 (see
// LLM_RERANK_WEIGHT = 0.5). Equal weights per filter, per spec.
export const SIGNAL_WEIGHTS: Record<SignalKey, number> = {
  industry_match: 10,
  size_match: 10,
  revenue_match: 10,
  location_match: 10,
  title_relevance: 10,
  hiring_match: 10,
};

export const STRONG_FIT_THRESHOLD = 0.75;
export const MEDIUM_FIT_THRESHOLD = 0.45;

// Who we're selling for. Gives the LLM judge the context to score companies
// as PROSPECTS (would they buy this?) instead of just industry membership.
// Sourced from muralpay.com positioning.
export const SELLER_CONTEXT = [
  "You are scoring sales prospects for Mural Pay (muralpay.com).",
  "Mural Pay is stablecoin-powered financial infrastructure delivered as an API: multi-currency accounts and wallets (USD, COP, ARS, MXN, stablecoins), real-time cross-border payments, FX conversion, and built-in compliance. Built for global companies that move money at scale, with particular strength in Latin America.",
  "Reference customers: Opera pays thousands of content creators instantly in stablecoins; Deel runs compliant stablecoin payroll worldwide; Bolt embeds merchant accounts so merchants accept stablecoins and pay vendors globally; Koywe uses it for stablecoin-to-local-currency conversion across Latin America.",
  "The best prospects are ONLINE platforms, fintechs, marketplaces, and payroll providers that regularly move money to many recipients — marketplace sellers and vendors, creators, contractors, gig workers, bettors/winners, or international employees. High payout volume is the key signal; cross-border or Latin America exposure is a bonus, NOT a requirement — domestic-only platforms with heavy payout flows are still strong prospects.",
  "Calibration anchors: prediction markets and betting platforms paying many winners (e.g. Kalshi), creator/digital-product marketplaces paying sellers (e.g. Whop), and fantasy/sportsbook apps (e.g. Underdog) are IDEAL prospects — score them 85-100. Use the full 0-100 range.",
  "Weak prospects: brick-and-mortar venues (physical casinos, stores, restaurants), companies that rarely pay out money to others, and companies that serve these industries without operating payout flows themselves.",
].join(" ");

// LLM re-rank: judges whether candidates are real Mural Pay prospects.
// Final score = (1 - weight) * filter score + weight * LLM score.
// 0.5 = the 50/50 composite: filters contribute up to 50 points, AI the
// other 50. Companies the AI never judged score 0 on the AI half, so they
// can never outrank judged companies. Skipped when ANTHROPIC_API_KEY unset.
export const LLM_RERANK_MODEL = "claude-haiku-4-5-20251001";
export const LLM_RERANK_WEIGHT = 0.5;

// Companies the LLM was asked about but returned no verdict for get a
// neutral score instead of keeping their raw rule score (which would let
// unjudged companies leapfrog judged ones).
export const LLM_NEUTRAL_SCORE = 0.5;

// LLM pre-screen: when the Anthropic key is set, fetch a deeper candidate
// pool (limit x multiplier, capped by MAX_SEARCH_PAGES) and screen it by
// name/domain BEFORE spending enrichment credits, so enrichment is spent on
// plausible operators instead of whatever Apollo lists first.
export const PRESCREEN_MULTIPLIER = 10;

export const DEFAULT_FILTERS: CompanyFilters = {
  keywords: ["payroll", "e-com", "marketplace", "betting"],
  employeeRanges: ["50,200", "200,500"],
  revenueMin: 10000000,
  locations: ["United States", "Mexico", "Brazil"],
  jobTitles: ["CPO", "CLO", "CFO"],
  hiringTitles: [],
};

export type FilterGroupKey =
  | "keywords"
  | "employeeRanges"
  | "locations"
  | "jobTitles"
  | "hiringTitles";

export type FilterOption = {
  // Sent to the API (and used as the KEYWORD_SYNONYMS key for keywords).
  value: string;
  // Shown in the UI.
  label: string;
};

export type FilterGroup = {
  key: FilterGroupKey;
  label: string;
  // Whether users can type their own values in addition to the presets.
  allowCustom: boolean;
  options: FilterOption[];
};

export const FILTER_GROUPS: FilterGroup[] = [
  {
    key: "keywords",
    label: "Industries",
    allowCustom: false,
    options: [
      { value: "payroll", label: "Payroll" },
      { value: "e-com", label: "E-commerce" },
      { value: "marketplace", label: "Marketplace" },
      { value: "betting", label: "Betting & Prediction Markets" },
    ],
  },
  {
    key: "employeeRanges",
    label: "Company size",
    allowCustom: false,
    options: [
      { value: "1,10", label: "1-10" },
      { value: "11,50", label: "11-50" },
      { value: "50,200", label: "50-200" },
      { value: "200,500", label: "200-500" },
      { value: "500,1000", label: "500-1,000" },
    ],
  },
  {
    key: "locations",
    label: "Locations",
    allowCustom: false,
    options: [
      { value: "United States", label: "United States" },
      { value: "Mexico", label: "Mexico" },
      { value: "Brazil", label: "Brazil" },
    ],
  },
  {
    key: "jobTitles",
    label: "Buyer personas",
    allowCustom: true,
    options: [
      { value: "CPO", label: "CPO" },
      { value: "CLO", label: "CLO" },
      { value: "CFO", label: "CFO" },
    ],
  },
  {
    key: "hiringTitles",
    label: "Hiring for",
    allowCustom: true,
    options: HIRING_TITLE_OPTIONS.map((title) => ({
      value: title,
      label: title,
    })),
  },
];
