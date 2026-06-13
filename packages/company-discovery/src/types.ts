export type CompanyFilters = {
  keywords: string[];
  employeeRanges: string[];
  revenueMin: number;
  locations: string[];
  jobTitles: string[];
  hiringTitles: string[];
};

export type CompanySearchRequest = {
  filters: CompanyFilters;
  limit: number;
};

export type SignalKey =
  | "industry_match"
  | "size_match"
  | "revenue_match"
  | "location_match"
  | "title_relevance"
  | "hiring_match";

export type CompanySignal = {
  key: SignalKey;
  label: string;
  matched: boolean;
  // The corresponding filter is selected, so this signal counts toward the
  // score denominator. Unknown data is a miss for ranking purposes — a
  // company with no data must not outrank a verified one.
  active: boolean;
  // Data exists to evaluate the signal (used for display: "missing" vs "no").
  available: boolean;
};

export type FitLabel = "Strong" | "Medium" | "Weak";

export type DiscoveredCompany = {
  id: string;
  name: string;
  websiteUrl: string | null;
  domain: string | null;
  industry: string | null;
  employeeCount: number | null;
  sizeBucket: string | null;
  annualRevenue: number | null;
  revenueDisplay: string | null;
  foundedYear: number | null;
  phone: string | null;
  linkedinUrl: string | null;
  headcountGrowthTwelveMonths: number | null;
  location: string | null;
  matchedFilters: string[];
  signals: CompanySignal[];
  score: number;
  // 0-1 LLM ICP judgment; null when the re-rank did not run.
  llmScore: number | null;
  llmReason: string | null;
  fit: FitLabel;
};

export type CompanySearchResponse = {
  companies: DiscoveredCompany[];
  requestedLimit: number;
  returnedCount: number;
};

export type ApolloOrganization = {
  id?: string;
  name?: string;
  website_url?: string;
  primary_domain?: string;
  industry?: string;
  keywords?: string[];
  estimated_num_employees?: number;
  annual_revenue?: number;
  organization_revenue?: number;
  organization_revenue_printed?: string;
  founded_year?: number;
  phone?: string;
  primary_phone?: {
    number?: string;
  };
  sanitized_phone?: string;
  linkedin_url?: string;
  organization_headcount_twelve_month_growth?: number;
  city?: string;
  state?: string;
  country?: string;
  organization_city?: string;
  organization_state?: string;
  organization_country?: string;
  short_description?: string;
  seo_description?: string;
  person_titles?: string[];
};

export type ApolloPerson = {
  organization_id?: string;
  organization?: {
    id?: string;
  };
  title?: string;
};

export type ApolloPeopleSearchResponse = {
  people?: ApolloPerson[];
  contacts?: ApolloPerson[];
};

export type ApolloBulkEnrichResponse = {
  organizations?: ApolloOrganization[];
};

export type ApolloSearchResponse = {
  organizations?: ApolloOrganization[];
  accounts?: ApolloOrganization[];
  pagination?: {
    page?: number;
    per_page?: number;
    total_entries?: number;
    total_pages?: number;
  };
};
