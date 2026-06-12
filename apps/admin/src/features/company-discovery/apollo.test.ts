import { describe, expect, it, vi } from "vitest";

import {
  buildApolloSearchBody,
  computeScore,
  enrichOrganizations,
  expandBuyerTitles,
  expandKeywords,
  getApolloOrganizations,
  matchesActiveLocations,
  normalizeApolloCompany,
  normalizeLimit,
  parseCompanySearchRequest,
  searchApolloCompanies,
} from "./apollo";
import {
  DEFAULT_COMPANY_LIMIT,
  DEFAULT_FILTERS,
  MAX_COMPANY_LIMIT,
} from "./constants";

describe("company discovery defaults", () => {
  it("uses the approved ICP defaults", () => {
    expect(DEFAULT_FILTERS).toEqual({
      keywords: ["payroll", "e-com", "marketplace", "betting"],
      employeeRanges: ["50,200", "200,500"],
      revenueMin: 10000000,
      locations: ["United States", "Mexico", "Brazil"],
      jobTitles: ["CPO", "CLO", "CFO"],
      hiringTitles: [],
    });
  });

  it("defaults to 10 companies and caps large requests", () => {
    expect(DEFAULT_COMPANY_LIMIT).toBe(10);
    expect(MAX_COMPANY_LIMIT).toBe(100);
  });
});

describe("keyword and title expansion", () => {
  it("expands chips to curated tag clusters without the noisy bare term", () => {
    expect(expandKeywords(["payroll"])).toContain("payroll software");
    expect(expandKeywords(["payroll"])).toContain("employer of record");
    expect(expandKeywords(["payroll"])).not.toContain("payroll");

    expect(expandKeywords(["betting"])).toContain("prediction markets");
    expect(expandKeywords(["betting"])).toContain("sportsbook");
    expect(expandKeywords(["betting"])).not.toContain("betting");

    expect(expandKeywords(["marketplace"])).toContain("creator marketplace");
    expect(expandKeywords(["unknown-tag"])).toEqual(["unknown-tag"]);
  });

  it("expands buyer acronyms to full titles", () => {
    expect(expandBuyerTitles(["CFO"])).toEqual(["chief financial officer"]);
    expect(expandBuyerTitles(["VP Finance"])).toEqual(["VP Finance"]);
  });
});

describe("buildApolloSearchBody", () => {
  it("maps filters to Apollo fields with curated keyword clusters", () => {
    const body = buildApolloSearchBody({
      filters: {
        ...DEFAULT_FILTERS,
        hiringTitles: ["payroll specialist"],
      },
      limit: 10,
      page: 2,
      perPage: 25,
    });

    expect(body.q_organization_keyword_tags).toEqual(
      expandKeywords(DEFAULT_FILTERS.keywords),
    );
    expect(body.q_organization_keyword_tags).toContain("payroll software");
    expect(body.q_organization_keyword_tags).toContain("prediction markets");
    expect(body).toMatchObject({
      organization_num_employees_ranges: ["50,200", "200,500"],
      organization_locations: ["United States", "Mexico", "Brazil"],
      q_organization_job_titles: ["payroll specialist"],
      revenue_range: {
        min: 10000000,
      },
      per_page: 25,
      page: 2,
    });
  });

  it("omits the revenue range when the floor is toggled off", () => {
    const body = buildApolloSearchBody({
      filters: {
        ...DEFAULT_FILTERS,
        revenueMin: 0,
      },
      limit: 10,
      page: 1,
    });

    expect(body.revenue_range).toBeUndefined();
  });
});

describe("normalizeLimit", () => {
  it("keeps valid requested limits", () => {
    expect(normalizeLimit(25)).toBe(25);
  });

  it("uses the default limit for invalid values", () => {
    expect(normalizeLimit(0)).toBe(DEFAULT_COMPANY_LIMIT);
    expect(normalizeLimit(Number.NaN)).toBe(DEFAULT_COMPANY_LIMIT);
  });

  it("caps requests at the maximum company limit", () => {
    expect(normalizeLimit(500)).toBe(MAX_COMPANY_LIMIT);
  });
});

describe("normalizeApolloCompany", () => {
  const richOrganization = {
    id: "org_123",
    name: "Acme Payroll",
    website_url: "https://acme.example",
    industry: "Payroll Software",
    keywords: ["payroll", "fintech"],
    estimated_num_employees: 180,
    annual_revenue: 25000000,
    city: "Austin",
    state: "Texas",
    country: "United States",
  };

  it("derives a strong fit when all available signals match", () => {
    const company = normalizeApolloCompany(richOrganization, DEFAULT_FILTERS);

    expect(company).toMatchObject({
      id: "org_123",
      employeeCount: 180,
      sizeBucket: "50,200",
      location: "Austin, Texas, United States",
      matchedFilters: ["payroll", "50,200", "United States", "Revenue 10M+"],
      // 8 of 10 active weight: buyer title unverified counts as a miss for
      // ranking so sparse records can't outrank verified ones.
      score: 8 / 10,
      fit: "Strong",
    });

    // Buyer-title data is still flagged unavailable for display.
    const titleSignal = company.signals.find(
      (signal) => signal.key === "title_relevance",
    );
    expect(titleSignal?.available).toBe(false);
  });

  it("counts a verified buyer title in the score", () => {
    const verified = normalizeApolloCompany(richOrganization, DEFAULT_FILTERS, true);
    const failed = normalizeApolloCompany(richOrganization, DEFAULT_FILTERS, false);

    expect(verified.score).toBe(1);
    expect(verified.fit).toBe("Strong");
    expect(failed.score).toBeCloseTo(8 / 10);
    expect(failed.fit).toBe("Strong");
  });

  it("matches industry keywords through synonyms", () => {
    const company = normalizeApolloCompany(
      {
        id: "org_456",
        name: "ShopRail",
        short_description: "An e-commerce platform for sellers",
      },
      DEFAULT_FILTERS,
    );

    expect(company.matchedFilters).toContain("e-com");
    expect(
      company.signals.find((signal) => signal.key === "industry_match")?.matched,
    ).toBe(true);
  });

  it("scores sparse records low instead of inflating them", () => {
    const company = normalizeApolloCompany({ name: "Sparse Co" }, DEFAULT_FILTERS);

    expect(company.matchedFilters).toEqual([]);
    expect(company.score).toBe(0);
    expect(company.fit).toBe("Weak");
    expect(company.signals.every((signal) => !signal.available)).toBe(true);
  });

  it("does not let a revenue-only CRM stub score 100%", () => {
    const company = normalizeApolloCompany(
      {
        id: "acct_1",
        name: "Ampstek",
        organization_revenue: 47400000,
      },
      DEFAULT_FILTERS,
    );

    // Revenue (2) is the only match out of 10 active weight.
    expect(company.score).toBe(2 / 10);
    expect(company.fit).toBe("Weak");
  });
});

describe("computeScore", () => {
  it("divides matched weight by all active filter weight", () => {
    expect(
      computeScore([
        { key: "industry_match", label: "", matched: true, active: true, available: true },
        { key: "size_match", label: "", matched: false, active: true, available: false },
        { key: "revenue_match", label: "", matched: false, active: true, available: true },
      ]),
    ).toBe(1 / 3);
  });

  it("ignores inactive filters", () => {
    expect(
      computeScore([
        { key: "industry_match", label: "", matched: true, active: true, available: true },
        { key: "hiring_match", label: "", matched: false, active: false, available: false },
      ]),
    ).toBe(1);
  });

  it("returns 0 when nothing is active", () => {
    expect(computeScore([])).toBe(0);
  });
});

describe("matchesActiveLocations", () => {
  it("drops companies whose known location contradicts the filter", () => {
    // Regression: Greek sportsbook returned by Apollo under a US filter.
    expect(
      matchesActiveLocations(
        { id: "1", city: "Athens", country: "Greece" },
        ["United States"],
      ),
    ).toBe(false);
  });

  it("keeps companies with matching or unknown locations", () => {
    expect(
      matchesActiveLocations(
        { id: "1", city: "Austin", state: "Texas", country: "United States" },
        ["United States", "Brazil"],
      ),
    ).toBe(true);
    // Missing data is not a mismatch.
    expect(matchesActiveLocations({ id: "2" }, ["United States"])).toBe(true);
    // No location filter -> everything passes.
    expect(matchesActiveLocations({ id: "3", country: "Greece" }, [])).toBe(true);
  });
});

describe("getApolloOrganizations", () => {
  it("drops CRM account records and dedupes organizations by id", () => {
    // Verified against a live response: accounts are workspace CRM records
    // (modality "account") that Apollo returns without applying keyword
    // filters — e.g. real-estate firms in an e-com search.
    expect(
      getApolloOrganizations({
        accounts: [
          { id: "1", name: "Account One" },
          { id: "3", name: "Account Three" },
        ],
        organizations: [
          { id: "2", name: "Organization Two" },
          { id: "2", name: "Duplicate Two" },
        ],
      }).map((company) => company.name),
    ).toEqual(["Organization Two"]);
  });
});

describe("enrichOrganizations", () => {
  it("enriches slim records by domain and merges scorable fields", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          organizations: [
            {
              id: "enriched_1",
              primary_domain: "woocommerce.com",
              estimated_num_employees: 250,
              industry: "internet",
              keywords: ["ecommerce"],
              country: "United States",
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await enrichOrganizations({
      apiKey: "test-key",
      organizations: [
        {
          id: "org_1",
          name: "WooCommerce",
          primary_domain: "woocommerce.com",
          organization_revenue: 32000000,
        },
      ],
      limit: 10,
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain("bulk_enrich");
    expect(result[0]).toMatchObject({
      id: "org_1",
      name: "WooCommerce",
      organization_revenue: 32000000,
      estimated_num_employees: 250,
      industry: "internet",
      country: "United States",
    });
  });

  it("skips enrichment when employee data already exists", async () => {
    const fetcher = vi.fn<typeof fetch>();

    const result = await enrichOrganizations({
      apiKey: "test-key",
      organizations: [
        { id: "org_1", primary_domain: "a.com", estimated_num_employees: 100 },
      ],
      limit: 10,
      fetcher,
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(result[0].estimated_num_employees).toBe(100);
  });

  it("scales enrichment to the requested limit (limit x 2)", async () => {
    const organizations = Array.from({ length: 10 }, (_, i) => ({
      id: `org_${i}`,
      primary_domain: `domain${i}.com`,
    }));

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ organizations: [] }), { status: 200 }));

    await enrichOrganizations({
      apiKey: "test-key",
      organizations,
      limit: 2,
      fetcher,
    });

    // limit 2 -> enrich 4 candidates -> a single batch call with 4 domains
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toEqual({
      domains: ["domain0.com", "domain1.com", "domain2.com", "domain3.com"],
    });
  });

  it("keeps slim records when enrichment fails", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 429 }));

    const result = await enrichOrganizations({
      apiKey: "test-key",
      organizations: [{ id: "org_1", name: "Slim Co", primary_domain: "slim.com" }],
      limit: 10,
      fetcher,
    });

    expect(result).toEqual([
      { id: "org_1", name: "Slim Co", primary_domain: "slim.com" },
    ]);
  });
});

describe("searchApolloCompanies", () => {
  const filtersWithoutPeopleCheck = {
    ...DEFAULT_FILTERS,
    jobTitles: [],
  };

  function organizationsPage(organizations: unknown[]) {
    return new Response(JSON.stringify({ organizations }), { status: 200 });
  }

  it("over-fetches candidates, ranks them, and returns the best ones", async () => {
    const weak = { id: "weak", name: "Weak Co" };
    const strong = {
      id: "strong",
      name: "Strong Co",
      industry: "Payroll",
      estimated_num_employees: 100,
      annual_revenue: 20000000,
      country: "United States",
    };

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(organizationsPage([weak, strong]))
      .mockResolvedValueOnce(organizationsPage([]));

    const result = await searchApolloCompanies({
      apiKey: "test-key",
      request: {
        filters: filtersWithoutPeopleCheck,
        limit: 1,
      },
      fetcher,
    });

    expect(result.returnedCount).toBe(1);
    expect(result.companies[0].name).toBe("Strong Co");
  });

  it("runs a people search to verify buyer titles on top candidates", async () => {
    const organization = {
      id: "org_1",
      name: "Verified Co",
      industry: "Payroll",
      estimated_num_employees: 100,
      annual_revenue: 20000000,
      country: "United States",
    };

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(organizationsPage([organization]))
      .mockResolvedValueOnce(organizationsPage([]))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            people: [{ organization_id: "org_1", title: "CFO" }],
          }),
          { status: 200 },
        ),
      );

    const result = await searchApolloCompanies({
      apiKey: "test-key",
      request: {
        filters: DEFAULT_FILTERS,
        limit: 1,
      },
      fetcher,
    });

    const peopleCall = fetcher.mock.calls[2];
    expect(peopleCall[0]).toContain("mixed_people/search");
    expect(JSON.parse(peopleCall[1]?.body as string)).toMatchObject({
      organization_ids: ["org_1"],
      person_titles: [
        "chief product officer",
        "chief legal officer",
        "chief financial officer",
      ],
    });

    const titleSignal = result.companies[0].signals.find(
      (signal) => signal.key === "title_relevance",
    );
    expect(titleSignal).toMatchObject({ available: true, matched: true });
  });

  it("keeps results when the people search fails", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(organizationsPage([{ id: "org_1", name: "One" }]))
      .mockResolvedValueOnce(organizationsPage([]))
      .mockResolvedValueOnce(new Response("{}", { status: 429 }));

    const result = await searchApolloCompanies({
      apiKey: "test-key",
      request: {
        filters: DEFAULT_FILTERS,
        limit: 10,
      },
      fetcher,
    });

    expect(result.returnedCount).toBe(1);
    const titleSignal = result.companies[0].signals.find(
      (signal) => signal.key === "title_relevance",
    );
    expect(titleSignal?.available).toBe(false);
  });

  it("blends LLM verdicts into scores and re-sorts when an Anthropic key is set", async () => {
    const adTech = {
      id: "adtech",
      name: "Local Corporation",
      industry: "marketing & advertising",
      keywords: ["online marketplace"],
      estimated_num_employees: 300,
      annual_revenue: 70000000,
      country: "United States",
    };
    const operator = {
      id: "operator",
      name: "Real Marketplace Co",
      industry: "internet",
      keywords: ["online marketplace"],
      estimated_num_employees: 300,
      annual_revenue: 70000000,
      country: "United States",
    };

    const verdictsJson =
      '[{"id": "adtech", "score": 10, "reason": "ad-tech, not operator"}, {"id": "operator", "score": 95, "reason": "true marketplace operator"}]';
    const anthropicResponse = () =>
      new Response(
        JSON.stringify({ content: [{ type: "text", text: verdictsJson }] }),
        { status: 200 },
      );

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(organizationsPage([adTech, operator]))
      .mockResolvedValueOnce(organizationsPage([]))
      // pre-screen call, then final re-rank call
      .mockResolvedValueOnce(anthropicResponse())
      .mockResolvedValueOnce(anthropicResponse());

    const result = await searchApolloCompanies({
      apiKey: "test-key",
      request: {
        filters: filtersWithoutPeopleCheck,
        limit: 2,
      },
      anthropicApiKey: "anthropic-key",
      fetcher,
    });

    expect(result.companies[0].id).toBe("operator");
    expect(result.companies[0].llmReason).toBe("true marketplace operator");
    // 50/50 composite: filters 1.0, AI 0.95 -> 0.975
    expect(result.companies[0].score).toBeCloseTo(0.975);
    expect(result.companies[0].fit).toBe("Strong");
    // filters 1.0, AI 0.10 -> 0.55 -> Medium
    expect(result.companies[1].score).toBeCloseTo(0.55);
    expect(result.companies[1].fit).toBe("Medium");
  });

  it("gives a neutral score to judged companies the LLM skipped", async () => {
    // Regression: an unjudged company must not keep its raw rule score and
    // leapfrog judged companies (the "Synergis bug").
    const skipped = {
      id: "skipped",
      name: "Synergis",
      industry: "Payroll",
      keywords: ["payroll software"],
      estimated_num_employees: 300,
      annual_revenue: 30000000,
      country: "United States",
    };
    const judged = {
      id: "judged",
      name: "Real Payroll Co",
      industry: "Payroll",
      keywords: ["payroll software"],
      estimated_num_employees: 300,
      annual_revenue: 30000000,
      country: "United States",
    };

    const anthropicResponse = () =>
      new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              // No verdict for "skipped"
              text: '[{"id": "judged", "score": 85, "reason": "payroll operator"}]',
            },
          ],
        }),
        { status: 200 },
      );

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(organizationsPage([skipped, judged]))
      .mockResolvedValueOnce(organizationsPage([]))
      .mockResolvedValueOnce(anthropicResponse())
      .mockResolvedValueOnce(anthropicResponse());

    const result = await searchApolloCompanies({
      apiKey: "test-key",
      request: {
        filters: filtersWithoutPeopleCheck,
        limit: 2,
      },
      anthropicApiKey: "anthropic-key",
      fetcher,
    });

    expect(result.companies[0].id).toBe("judged");
    const skippedCompany = result.companies.find((c) => c.id === "skipped");
    // filters 1.0 (50 pts) + neutral AI 0.5 (25 pts) = 0.75
    expect(skippedCompany?.score).toBeCloseTo(0.75);
    expect(skippedCompany?.llmScore).toBeNull();
  });

  it("spends enrichment on pre-screen winners, not Apollo's first listings", async () => {
    // limit 1 -> enrich up to 2. Apollo lists two staffing firms first; the
    // pre-screen ranks the operator highest, so it must be enriched first.
    const slimCandidates = [
      { id: "staffing_1", name: "Atlantic Staffing", primary_domain: "staffing1.com" },
      { id: "staffing_2", name: "Bachrach Recruiting", primary_domain: "staffing2.com" },
      { id: "operator", name: "Dominion Payroll", primary_domain: "dominionpayroll.com" },
    ];

    const enrichBodies: Array<{ domains: string[] }> = [];
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const urlText = String(url);

      if (urlText.includes("mixed_companies")) {
        const page = JSON.parse(String(init?.body)).page as number;

        return new Response(
          JSON.stringify({ organizations: page === 1 ? slimCandidates : [] }),
          { status: 200 },
        );
      }

      if (urlText.includes("bulk_enrich")) {
        enrichBodies.push(JSON.parse(String(init?.body)));

        return new Response(JSON.stringify({ organizations: [] }), { status: 200 });
      }

      // Anthropic calls (pre-screen + final re-rank)
      return new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: '[{"id": "operator", "score": 90, "reason": "payroll operator"}, {"id": "staffing_1", "score": 10, "reason": "staffing"}, {"id": "staffing_2", "score": 10, "reason": "staffing"}]',
            },
          ],
        }),
        { status: 200 },
      );
    });

    const result = await searchApolloCompanies({
      apiKey: "test-key",
      request: {
        filters: filtersWithoutPeopleCheck,
        limit: 1,
      },
      anthropicApiKey: "anthropic-key",
      fetcher,
    });

    expect(enrichBodies).toEqual([
      { domains: ["dominionpayroll.com", "staffing1.com"] },
    ]);
    expect(result.companies[0].id).toBe("operator");
  });

  it("keeps rule scores when no Anthropic key is provided", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        organizationsPage([{ id: "1", name: "One", estimated_num_employees: 100 }]),
      )
      .mockResolvedValueOnce(organizationsPage([]));

    const result = await searchApolloCompanies({
      apiKey: "test-key",
      request: {
        filters: filtersWithoutPeopleCheck,
        limit: 1,
      },
      fetcher,
    });

    // Apollo search pages only; no Anthropic call.
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.companies[0].llmScore).toBeNull();
  });

  it("stops when Apollo returns an empty page", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(organizationsPage([{ id: "1", name: "One" }]))
      .mockResolvedValueOnce(organizationsPage([]));

    const result = await searchApolloCompanies({
      apiKey: "test-key",
      request: {
        filters: filtersWithoutPeopleCheck,
        limit: 10,
      },
      fetcher,
    });

    expect(result.returnedCount).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("throws a clear Apollo status error when Apollo fails", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }));

    await expect(
      searchApolloCompanies({
        apiKey: "bad-key",
        request: {
          filters: DEFAULT_FILTERS,
          limit: 10,
        },
        fetcher,
      }),
    ).rejects.toThrow("Apollo search failed with status 401");
  });
});

describe("parseCompanySearchRequest", () => {
  it("accepts a complete company search request", () => {
    expect(
      parseCompanySearchRequest({
        filters: DEFAULT_FILTERS,
        limit: 10,
      }),
    ).toEqual({
      filters: DEFAULT_FILTERS,
      limit: 10,
    });
  });

  it("defaults hiringTitles when omitted", () => {
    const request = parseCompanySearchRequest({
      filters: { keywords: ["payroll"] },
      limit: 10,
    });

    expect(request.filters.hiringTitles).toEqual([]);
  });

  it("rejects requests without filters", () => {
    expect(() => parseCompanySearchRequest({ limit: 10 })).toThrow(
      "Filters are required",
    );
  });
});
