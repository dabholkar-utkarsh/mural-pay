import type { DiscoveredCompany } from "./types";

export type CompanyExportRow = {
  Rank: number;
  "Company Name": string;
  Domain: string;
  Website: string;
  Industry: string;
  Employees: number | "";
  "Size Bucket": string;
  "Annual Revenue": number | "";
  "Revenue Display": string;
  Location: string;
  Fit: string;
  Score: number;
  "LLM Score": number | "";
  "LLM Reason": string;
  "Matched Filters": string;
  "Matched Signals": string;
  LinkedIn: string;
  Phone: string;
  "Founded Year": number | "";
  "12 Month Headcount Growth": number | "";
};

export function buildCompanyExportRows(
  companies: DiscoveredCompany[],
): CompanyExportRow[] {
  return companies.map((company, index) => ({
    Rank: index + 1,
    "Company Name": company.name,
    Domain: company.domain ?? "",
    Website: company.websiteUrl ?? "",
    Industry: company.industry ?? "",
    Employees: company.employeeCount ?? "",
    "Size Bucket": company.sizeBucket ?? "",
    "Annual Revenue": company.annualRevenue ?? "",
    "Revenue Display": company.revenueDisplay ?? "",
    Location: company.location ?? "",
    Fit: company.fit,
    Score: company.score,
    "LLM Score": company.llmScore ?? "",
    "LLM Reason": company.llmReason ?? "",
    "Matched Filters": company.matchedFilters.join("; "),
    "Matched Signals": company.signals
      .filter((signal) => signal.matched)
      .map((signal) => signal.label)
      .join("; "),
    LinkedIn: company.linkedinUrl ?? "",
    Phone: company.phone ?? "",
    "Founded Year": company.foundedYear ?? "",
    "12 Month Headcount Growth": company.headcountGrowthTwelveMonths ?? "",
  }));
}
