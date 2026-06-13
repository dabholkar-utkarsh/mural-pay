import {
  APOLLO_PER_PAGE,
  BUYER_TITLE_EXPANSIONS,
  DEFAULT_COMPANY_LIMIT,
  ENRICH_BATCH_SIZE,
  ENRICH_MAX,
  ENRICH_MULTIPLIER,
  KEYWORD_SYNONYMS,
  MAX_COMPANY_LIMIT,
  MAX_SEARCH_PAGES,
  LLM_NEUTRAL_SCORE,
  LLM_RERANK_WEIGHT,
  MEDIUM_FIT_THRESHOLD,
  OVERFETCH_MULTIPLIER,
  PEOPLE_CHECK_COUNT,
  PRESCREEN_MULTIPLIER,
  SIGNAL_WEIGHTS,
  STRONG_FIT_THRESHOLD,
} from "./constants";
import { rerankWithLlm, type LlmVerdict } from "./rerank";
import type { CompanySearchRequest } from "./types";
import type {
  ApolloBulkEnrichResponse,
  ApolloOrganization,
  ApolloPeopleSearchResponse,
  ApolloSearchResponse,
  CompanyFilters,
  CompanySignal,
  DiscoveredCompany,
  FitLabel,
} from "./types";

const APOLLO_SEARCH_URL = "https://api.apollo.io/api/v1/mixed_companies/search";
const APOLLO_PEOPLE_SEARCH_URL =
  "https://api.apollo.io/api/v1/mixed_people/search";
const APOLLO_BULK_ENRICH_URL =
  "https://api.apollo.io/api/v1/organizations/bulk_enrich";

type BuildApolloSearchBodyInput = CompanySearchRequest & {
  page: number;
  perPage?: number;
};

type ApolloSearchBody = {
  q_organization_keyword_tags: string[];
  organization_num_employees_ranges: string[];
  organization_locations: string[];
  q_organization_job_titles: string[];
  // Omitted when the revenue floor is toggled off — Apollo lacks revenue
  // data for many young companies, so a hard floor erases whole verticals.
  revenue_range?: {
    min: number;
  };
  per_page: number;
  page: number;
};

export function normalizeLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 1) {
    return DEFAULT_COMPANY_LIMIT;
  }

  return Math.min(Math.floor(limit), MAX_COMPANY_LIMIT);
}

export function expandKeywords(keywords: string[]): string[] {
  const expanded = keywords.flatMap(
    (keyword) => KEYWORD_SYNONYMS[keyword.toLowerCase()] ?? [keyword],
  );

  return Array.from(new Set(expanded));
}

export function expandBuyerTitles(titles: string[]): string[] {
  const expanded = titles.flatMap(
    (title) => BUYER_TITLE_EXPANSIONS[title.toUpperCase()] ?? [title],
  );

  return Array.from(new Set(expanded));
}

export function buildApolloSearchBody({
  filters,
  page,
  perPage = APOLLO_PER_PAGE,
}: BuildApolloSearchBodyInput): ApolloSearchBody {
  const body: ApolloSearchBody = {
    q_organization_keyword_tags: expandKeywords(filters.keywords),
    organization_num_employees_ranges: filters.employeeRanges,
    organization_locations: filters.locations,
    // "Hiring for" roles: Apollo filters by titles in ACTIVE JOB POSTINGS.
    // Buyer personas (filters.jobTitles) are verified via people search instead.
    q_organization_job_titles: filters.hiringTitles,
    per_page: perPage,
    page,
  };

  if (filters.revenueMin > 0) {
    body.revenue_range = { min: filters.revenueMin };
  }

  return body;
}

export async function searchApolloCompanies({
  apiKey,
  request,
  anthropicApiKey,
  fetcher = fetch,
}: {
  apiKey: string;
  request: CompanySearchRequest;
  anthropicApiKey?: string;
  fetcher?: typeof fetch;
}) {
  const requestedLimit = normalizeLimit(request.limit);
  // With an LLM pre-screen available, a deeper pool is worth the extra
  // search pages; without it, the extra candidates would go unranked.
  const overfetchMultiplier = anthropicApiKey
    ? PRESCREEN_MULTIPLIER
    : OVERFETCH_MULTIPLIER;
  const candidateTarget = Math.min(
    requestedLimit * overfetchMultiplier,
    MAX_SEARCH_PAGES * APOLLO_PER_PAGE,
  );
  const organizations: ApolloOrganization[] = [];
  let page = 1;

  while (organizations.length < candidateTarget && page <= MAX_SEARCH_PAGES) {
    const response = await fetcher(APOLLO_SEARCH_URL, {
      method: "POST",
      headers: apolloHeaders(apiKey),
      body: JSON.stringify(
        buildApolloSearchBody({
          filters: request.filters,
          limit: requestedLimit,
          page,
          perPage: APOLLO_PER_PAGE,
        }),
      ),
    });

    if (!response.ok) {
      throw new Error(`Apollo search failed with status ${response.status}`);
    }

    const data = (await response.json()) as ApolloSearchResponse;
    const pageOrganizations = getApolloOrganizations(data);

    console.log(
      `[company-search] page ${page}: ${data.organizations?.length ?? 0} organizations, ` +
        `${data.accounts?.length ?? 0} accounts (CRM stubs), ` +
        `total_entries=${data.pagination?.total_entries ?? "?"}`,
    );

    if (pageOrganizations.length === 0) {
      break;
    }

    organizations.push(...pageOrganizations);
    page += 1;
  }

  // Pre-screen the slim candidates by name/domain so enrichment credits go
  // to plausible operators, not whatever Apollo happens to list first.
  // Scores only (no reasons) — this is the wide, latency-sensitive call.
  // The verdicts are reused later as the AI score for companies that don't
  // make the final (reasoned) re-rank pool.
  let prescreenVerdicts: Map<string, LlmVerdict> | null = null;

  if (anthropicApiKey && organizations.length > 0) {
    prescreenVerdicts = await rerankWithLlm({
      apiKey: anthropicApiKey,
      organizations,
      filters: request.filters,
      includeReasons: false,
      fetcher,
    });

    if (prescreenVerdicts !== null) {
      const verdictsByKey = prescreenVerdicts;
      const prescreenScore = (organization: ApolloOrganization) => {
        const key =
          organization.id ?? organization.primary_domain ?? organization.name;

        return (key && verdictsByKey.get(key)?.score) || 0;
      };

      organizations.sort((a, b) => prescreenScore(b) - prescreenScore(a));
    }
  }

  const enrichedOrganizations = (
    await enrichOrganizations({
      apiKey,
      organizations,
      limit: requestedLimit,
      fetcher,
    })
  ).filter((organization) =>
    matchesActiveLocations(organization, request.filters.locations),
  );

  let companies = enrichedOrganizations.map((organization) =>
    normalizeApolloCompany(organization, request.filters),
  );
  companies.sort((a, b) => b.score - a.score);

  const organizationById = new Map(
    enrichedOrganizations.map((organization) => [
      organization.id ?? organization.primary_domain ?? organization.name,
      organization,
    ]),
  );

  // Buyer verification and the final reasoned re-rank are independent calls
  // over the same top pool, so they run concurrently. The pool is picked
  // BEFORE verification adjusts scores — verification only moves one
  // 10-point signal, so pool membership is effectively unchanged, and the
  // sequential round-trip it used to cost is saved.
  const topPool = companies.slice(0, PEOPLE_CHECK_COUNT);
  const checkIds = topPool.map((company) => company.id);

  const [verifiedIds, finalVerdicts] = await Promise.all([
    request.filters.jobTitles.length > 0 && checkIds.length > 0
      ? findOrganizationsWithBuyerTitles({
          apiKey,
          organizationIds: checkIds,
          buyerTitles: request.filters.jobTitles,
          fetcher,
        })
      : Promise.resolve(null),
    // Final, reasoned judgment over the top candidates only (the ones that
    // can appear in results — they now carry enriched data). Companies
    // outside this pool keep their pre-screen AI score, so every candidate
    // still has an AI score without paying for ~100 written reasons.
    anthropicApiKey && topPool.length > 0
      ? rerankWithLlm({
          apiKey: anthropicApiKey,
          organizations: topPool
            .map((company) => organizationById.get(company.id))
            .filter((organization): organization is ApolloOrganization =>
              Boolean(organization),
            ),
          filters: request.filters,
          fetcher,
        })
      : Promise.resolve(null),
  ]);

  if (verifiedIds !== null) {
    const checkIdSet = new Set(checkIds);

    companies = companies.map((company) => {
      if (!checkIdSet.has(company.id)) {
        return company;
      }

      const organization = organizationById.get(company.id);

      return organization
        ? normalizeApolloCompany(
            organization,
            request.filters,
            verifiedIds.has(company.id),
          )
        : company;
    });
  }

  if (anthropicApiKey && (finalVerdicts !== null || prescreenVerdicts !== null)) {
    companies = companies.map((company) => {
      const verdict =
        finalVerdicts?.get(company.id) ?? prescreenVerdicts?.get(company.id);
      const llmScore = verdict?.score ?? LLM_NEUTRAL_SCORE;
      const blendedScore =
        (1 - LLM_RERANK_WEIGHT) * company.score +
        LLM_RERANK_WEIGHT * llmScore;

      return {
        ...company,
        score: blendedScore,
        llmScore: verdict?.score ?? null,
        llmReason: finalVerdicts?.get(company.id)?.reason || null,
        fit: getFitLabel(blendedScore),
      };
    });
  }

  companies.sort((a, b) => b.score - a.score);

  const topCompanies = companies.slice(0, requestedLimit);

  return {
    companies: topCompanies,
    requestedLimit,
    returnedCount: topCompanies.length,
  };
}

// The search endpoint returns organizations without employee counts,
// keywords, industry, or location. Enrich the first limit x ENRICH_MULTIPLIER
// candidates (capped at ENRICH_MAX) that are missing employee data so
// client-side scoring has real inputs. Failures degrade to slim records.
export async function enrichOrganizations({
  apiKey,
  organizations,
  limit,
  fetcher,
}: {
  apiKey: string;
  organizations: ApolloOrganization[];
  limit: number;
  fetcher: typeof fetch;
}): Promise<ApolloOrganization[]> {
  const enrichCount = Math.min(limit * ENRICH_MULTIPLIER, ENRICH_MAX);
  const domainsToEnrich = organizations
    .slice(0, enrichCount)
    .filter(
      (organization) =>
        organization.estimated_num_employees == null &&
        organization.primary_domain,
    )
    .map((organization) => organization.primary_domain as string);

  if (domainsToEnrich.length === 0) {
    return organizations;
  }

  const batches: string[][] = [];

  for (let i = 0; i < domainsToEnrich.length; i += ENRICH_BATCH_SIZE) {
    batches.push(domainsToEnrich.slice(i, i + ENRICH_BATCH_SIZE));
  }

  // Batches run in parallel — each failure degrades to slim records only.
  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      try {
        const response = await fetcher(APOLLO_BULK_ENRICH_URL, {
          method: "POST",
          headers: apolloHeaders(apiKey),
          body: JSON.stringify({ domains: batch }),
        });

        if (!response.ok) {
          return [];
        }

        const data = (await response.json()) as ApolloBulkEnrichResponse;

        return data.organizations ?? [];
      } catch {
        return [];
      }
    }),
  );

  const enrichedByDomain = new Map<string, ApolloOrganization>();

  for (const enriched of batchResults.flat()) {
    if (enriched?.primary_domain) {
      enrichedByDomain.set(enriched.primary_domain, enriched);
    }
  }

  if (enrichedByDomain.size === 0) {
    return organizations;
  }

  return organizations.map((organization) => {
    const enriched = organization.primary_domain
      ? enrichedByDomain.get(organization.primary_domain)
      : undefined;

    return enriched ? mergeOrganization(organization, enriched) : organization;
  });
}

// Prefer enriched values but never overwrite existing data with null/undefined.
function mergeOrganization(
  original: ApolloOrganization,
  enriched: ApolloOrganization,
): ApolloOrganization {
  const definedEnrichedEntries = Object.fromEntries(
    Object.entries(enriched).filter(([, value]) => value != null),
  );

  return { ...original, ...definedEnrichedEntries, id: original.id ?? enriched.id };
}

// Returns the set of organization ids where at least one buyer-persona title
// was found, or null when the people search fails (treated as unknown).
async function findOrganizationsWithBuyerTitles({
  apiKey,
  organizationIds,
  buyerTitles,
  fetcher,
}: {
  apiKey: string;
  organizationIds: string[];
  buyerTitles: string[];
  fetcher: typeof fetch;
}): Promise<Set<string> | null> {
  try {
    const response = await fetcher(APOLLO_PEOPLE_SEARCH_URL, {
      method: "POST",
      headers: apolloHeaders(apiKey),
      body: JSON.stringify({
        organization_ids: organizationIds,
        person_titles: expandBuyerTitles(buyerTitles),
        per_page: 100,
        page: 1,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as ApolloPeopleSearchResponse;
    const matchedIds = new Set<string>();

    for (const person of [...(data.people ?? []), ...(data.contacts ?? [])]) {
      const organizationId = person.organization_id ?? person.organization?.id;

      if (organizationId) {
        matchedIds.add(organizationId);
      }
    }

    return matchedIds;
  } catch {
    return null;
  }
}

// Hard geography gate: Apollo's HQ filter sometimes leaks foreign companies
// (e.g. a Greek sportsbook in a US search). When location filters are active
// and the enriched record's location is KNOWN and doesn't match, drop the
// company. Unknown locations are kept — missing data is not a mismatch.
export function matchesActiveLocations(
  organization: ApolloOrganization,
  locations: string[],
): boolean {
  if (locations.length === 0) {
    return true;
  }

  const location = formatLocation(organization)?.toLowerCase();

  if (!location) {
    return true;
  }

  return locations.some((filterLocation) =>
    location.includes(filterLocation.toLowerCase()),
  );
}

function apolloHeaders(apiKey: string) {
  return {
    "Cache-Control": "no-cache",
    "Content-Type": "application/json",
    accept: "application/json",
    "x-api-key": apiKey,
  };
}

export function getApolloOrganizations(
  data: ApolloSearchResponse,
): ApolloOrganization[] {
  // `accounts` are CRM records from the Apollo workspace (modality:
  // "account", source: rules_engine). Apollo injects them into responses
  // WITHOUT applying the keyword filters, so they pollute results with
  // unrelated companies. Use only prospected `organizations`.
  const byId = new Map<string, ApolloOrganization>();

  for (const organization of data.organizations ?? []) {
    const key =
      organization.id ??
      organization.primary_domain ??
      organization.website_url ??
      organization.name;

    if (key && !byId.has(key)) {
      byId.set(key, organization);
    }
  }

  return Array.from(byId.values());
}

export function parseCompanySearchRequest(value: unknown): CompanySearchRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Request body must be an object");
  }

  const body = value as Partial<CompanySearchRequest>;

  if (typeof body.filters !== "object" || body.filters === null) {
    throw new Error("Filters are required");
  }

  const filters = body.filters as Partial<CompanyFilters>;

  return {
    filters: {
      keywords: normalizeStringArray(filters.keywords),
      employeeRanges: normalizeStringArray(filters.employeeRanges),
      revenueMin:
        typeof filters.revenueMin === "number" && Number.isFinite(filters.revenueMin)
          ? filters.revenueMin
          : 10000000,
      locations: normalizeStringArray(filters.locations),
      jobTitles: normalizeStringArray(filters.jobTitles),
      hiringTitles: normalizeStringArray(filters.hiringTitles),
    },
    limit: normalizeLimit(body.limit),
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

export function normalizeApolloCompany(
  organization: ApolloOrganization,
  filters: CompanyFilters,
  // null = unverified (people search not run for this company yet)
  buyerTitleMatch: boolean | null = null,
): DiscoveredCompany {
  const employeeCount = organization.estimated_num_employees ?? null;
  const annualRevenue =
    organization.annual_revenue ?? organization.organization_revenue ?? null;
  const location = formatLocation(organization);
  const signals = buildSignals(organization, filters, buyerTitleMatch);
  const matchedFilters = buildMatchedFilters(organization, filters, signals);
  const score = computeScore(signals);

  return {
    id: organization.id ?? organization.primary_domain ?? organization.name ?? "unknown-company",
    name: organization.name ?? "Unknown company",
    websiteUrl: organization.website_url ?? null,
    domain: organization.primary_domain ?? null,
    industry: organization.industry ?? null,
    employeeCount,
    sizeBucket: getSizeBucket(employeeCount, filters.employeeRanges),
    annualRevenue,
    revenueDisplay:
      organization.organization_revenue_printed ??
      (annualRevenue !== null ? formatCurrency(annualRevenue) : null),
    foundedYear: organization.founded_year ?? null,
    phone: getPhoneNumber(organization),
    linkedinUrl: organization.linkedin_url ?? null,
    headcountGrowthTwelveMonths:
      organization.organization_headcount_twelve_month_growth ?? null,
    location,
    matchedFilters,
    signals,
    score,
    llmScore: null,
    llmReason: null,
    fit: getFitLabel(score),
  };
}

export function buildSignals(
  organization: ApolloOrganization,
  filters: CompanyFilters,
  buyerTitleMatch: boolean | null = null,
): CompanySignal[] {
  const searchableText = getSearchableText(organization);
  const employeeCount = organization.estimated_num_employees ?? null;
  const annualRevenue =
    organization.annual_revenue ?? organization.organization_revenue ?? null;
  const location = formatLocation(organization)?.toLowerCase() ?? "";

  return [
    {
      key: "industry_match" as const,
      label: "Industry keyword match",
      active: filters.keywords.length > 0,
      available: filters.keywords.length > 0 && searchableText.length > 0,
      matched: filters.keywords.some((keyword) =>
        matchesKeywordGroup(searchableText, keyword),
      ),
    },
    {
      key: "size_match" as const,
      label: "ICP size match",
      active: filters.employeeRanges.length > 0,
      available: filters.employeeRanges.length > 0 && employeeCount !== null,
      matched:
        employeeCount !== null &&
        filters.employeeRanges.some((range) =>
          isEmployeeCountInRange(employeeCount, range),
        ),
    },
    {
      key: "revenue_match" as const,
      label: "Revenue 10M+",
      active: filters.revenueMin > 0,
      available: annualRevenue !== null,
      matched: annualRevenue !== null && annualRevenue >= filters.revenueMin,
    },
    {
      key: "location_match" as const,
      label: "Target geography",
      active: filters.locations.length > 0,
      available: filters.locations.length > 0 && location.length > 0,
      matched: filters.locations.some((filterLocation) =>
        location.includes(filterLocation.toLowerCase()),
      ),
    },
    {
      key: "title_relevance" as const,
      label: "Relevant buying title",
      active: filters.jobTitles.length > 0,
      available: filters.jobTitles.length > 0 && buyerTitleMatch !== null,
      matched: buyerTitleMatch === true,
    },
    {
      // Apollo enforced q_organization_job_titles server-side, so every
      // returned company is actively hiring one of the selected roles.
      key: "hiring_match" as const,
      label: "Hiring target roles",
      active: filters.hiringTitles.length > 0,
      available: filters.hiringTitles.length > 0,
      matched: filters.hiringTitles.length > 0,
    },
  ];
}

export function computeScore(signals: CompanySignal[]): number {
  // Denominator is every ACTIVE filter, not just signals with data. A sparse
  // record (e.g. revenue-only CRM stub) must not score 100% by matching the
  // only signal it has data for.
  let activeWeight = 0;
  let matchedWeight = 0;

  for (const signal of signals) {
    if (!signal.active) {
      continue;
    }

    activeWeight += SIGNAL_WEIGHTS[signal.key];

    if (signal.matched) {
      matchedWeight += SIGNAL_WEIGHTS[signal.key];
    }
  }

  return activeWeight === 0 ? 0 : matchedWeight / activeWeight;
}

function getSearchableText(organization: ApolloOrganization): string {
  return [
    organization.industry,
    organization.short_description,
    organization.seo_description,
    ...(organization.keywords ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesKeywordGroup(searchableText: string, keyword: string): boolean {
  const synonyms = KEYWORD_SYNONYMS[keyword.toLowerCase()] ?? [keyword];

  return synonyms.some((synonym) =>
    searchableText.includes(synonym.toLowerCase()),
  );
}

function buildMatchedFilters(
  organization: ApolloOrganization,
  filters: CompanyFilters,
  signals: CompanySignal[],
): string[] {
  const matches: string[] = [];
  const text = getSearchableText(organization);

  matches.push(
    ...filters.keywords.filter((keyword) => matchesKeywordGroup(text, keyword)),
  );

  const employeeCount = organization.estimated_num_employees ?? null;

  if (employeeCount !== null) {
    matches.push(
      ...filters.employeeRanges.filter((range) =>
        isEmployeeCountInRange(employeeCount, range),
      ),
    );
  }

  const location = formatLocation(organization)?.toLowerCase() ?? "";

  matches.push(
    ...filters.locations.filter((filterLocation) =>
      location.includes(filterLocation.toLowerCase()),
    ),
  );

  if (signals.some((signal) => signal.key === "revenue_match" && signal.matched)) {
    matches.push("Revenue 10M+");
  }

  return Array.from(new Set(matches));
}

function formatLocation(organization: ApolloOrganization): string | null {
  const city = organization.city ?? organization.organization_city;
  const state = organization.state ?? organization.organization_state;
  const country = organization.country ?? organization.organization_country;
  const parts = [city, state, country].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : null;
}

function getPhoneNumber(organization: ApolloOrganization): string | null {
  return (
    organization.phone ??
    organization.sanitized_phone ??
    organization.primary_phone?.number ??
    null
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function getSizeBucket(
  employeeCount: number | null,
  ranges: string[],
): string | null {
  if (employeeCount === null) {
    return null;
  }

  return ranges.find((range) => isEmployeeCountInRange(employeeCount, range)) ?? null;
}

function isEmployeeCountInRange(employeeCount: number, range: string): boolean {
  const [min, max] = range
    .split(",")
    .map((value) => Number.parseInt(value, 10));

  return (
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    employeeCount >= min &&
    employeeCount <= max
  );
}

function getFitLabel(score: number): FitLabel {
  if (score >= STRONG_FIT_THRESHOLD) {
    return "Strong";
  }

  if (score >= MEDIUM_FIT_THRESHOLD) {
    return "Medium";
  }

  return "Weak";
}
