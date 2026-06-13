import { describe, expect, it } from "vitest";

import { buildCompanyExportRows } from "./export";
import type { DiscoveredCompany } from "./types";

const baseCompany: DiscoveredCompany = {
  id: "company-1",
  name: "Acme Payroll",
  websiteUrl: "https://acme.example",
  domain: "acme.example",
  industry: "Payroll",
  employeeCount: 120,
  sizeBucket: "50-200",
  annualRevenue: 25_000_000,
  revenueDisplay: "$25M",
  foundedYear: 2018,
  phone: "+1 555 0100",
  linkedinUrl: "https://linkedin.com/company/acme",
  headcountGrowthTwelveMonths: 18,
  location: "Austin, Texas, United States",
  matchedFilters: ["payroll", "50,200"],
  signals: [
    {
      key: "industry_match",
      label: "Industry match",
      matched: true,
      active: true,
      available: true,
    },
    {
      key: "revenue_match",
      label: "Revenue 5M+",
      matched: false,
      active: true,
      available: true,
    },
  ],
  score: 0.86,
  llmScore: 0.92,
  llmReason: "Strong payroll and market fit.",
  fit: "Strong",
};

describe("buildCompanyExportRows", () => {
  it("flattens displayed companies in UI order for spreadsheet export", () => {
    const rows = buildCompanyExportRows([
      baseCompany,
      {
        ...baseCompany,
        id: "company-2",
        name: "Beta Markets",
        domain: null,
        matchedFilters: [],
        signals: [],
        annualRevenue: null,
        revenueDisplay: null,
        llmScore: null,
        llmReason: null,
        fit: "Medium",
      },
    ]);

    expect(rows).toEqual([
      {
        Rank: 1,
        "Company Name": "Acme Payroll",
        Domain: "acme.example",
        Website: "https://acme.example",
        Industry: "Payroll",
        Employees: 120,
        "Size Bucket": "50-200",
        "Annual Revenue": 25_000_000,
        "Revenue Display": "$25M",
        Location: "Austin, Texas, United States",
        Fit: "Strong",
        Score: 0.86,
        "LLM Score": 0.92,
        "LLM Reason": "Strong payroll and market fit.",
        "Matched Filters": "payroll; 50,200",
        "Matched Signals": "Industry match",
        LinkedIn: "https://linkedin.com/company/acme",
        Phone: "+1 555 0100",
        "Founded Year": 2018,
        "12 Month Headcount Growth": 18,
      },
      expect.objectContaining({
        Rank: 2,
        "Company Name": "Beta Markets",
        Domain: "",
        "Annual Revenue": "",
        "Matched Filters": "",
        "Matched Signals": "",
        "LLM Score": "",
        "LLM Reason": "",
        Fit: "Medium",
      }),
    ]);
  });
});
