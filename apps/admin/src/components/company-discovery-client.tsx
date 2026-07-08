"use client";

import {
  AlertCircle,
  Building2,
  ChevronDown,
  Download,
  ExternalLink,
  Filter,
  Loader2,
  Search,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  buildCompanyExportRows,
  DEFAULT_COMPANY_LIMIT,
  DEFAULT_FILTERS,
  EMPTY_FILTERS,
  FILTER_GROUPS,
  MAX_COMPANY_LIMIT,
  REVENUE_SUGGESTIONS_MILLIONS,
} from "@mural/company-discovery";
import type {
  CompanyFilters,
  CompanySearchResponse,
  DiscoveredCompany,
  FilterGroupKey,
} from "@mural/company-discovery";
import { cn } from "@/lib/utils";
import { DERIVED_FILTERS_STORAGE_KEY } from "@/components/derive-icp-client";

type SearchState = "idle" | "loading" | "success" | "error";
type ToggleGroupKey = FilterGroupKey;

const chipBase =
  "cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const inputClass =
  "w-full rounded-xl border border-input bg-background px-3 py-2 text-foreground outline-none transition-colors duration-200 placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20";

const suggestionChipClass =
  "cursor-pointer rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors duration-200 hover:border-foreground/30 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function CompanyDiscoveryClient() {
  const [filters, setFilters] = useState<CompanyFilters>(DEFAULT_FILTERS);
  const [limitInput, setLimitInput] = useState(String(DEFAULT_COMPANY_LIMIT));
  const [drafts, setDrafts] = useState<Partial<Record<ToggleGroupKey, string>>>(
    {},
  );
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CompanySearchResponse | null>(null);

  // Filters handed over from the /icp "Apply to search" flow (one-shot).
  useEffect(() => {
    const raw = sessionStorage.getItem(DERIVED_FILTERS_STORAGE_KEY);

    if (!raw) {
      return;
    }

    sessionStorage.removeItem(DERIVED_FILTERS_STORAGE_KEY);

    try {
      const parsed = JSON.parse(raw) as Partial<CompanyFilters>;

      setFilters({
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
        employeeRanges: Array.isArray(parsed.employeeRanges)
          ? parsed.employeeRanges
          : [],
        revenueMin:
          typeof parsed.revenueMin === "number" && parsed.revenueMin > 0
            ? parsed.revenueMin
            : 0,
        locations: Array.isArray(parsed.locations) ? parsed.locations : [],
        jobTitles: Array.isArray(parsed.jobTitles) ? parsed.jobTitles : [],
        hiringTitles: Array.isArray(parsed.hiringTitles)
          ? parsed.hiringTitles
          : [],
      });
    } catch {
      // Corrupt handoff: keep the defaults.
    }
  }, []);

  const activeFilterCount = useMemo(
    () =>
      filters.keywords.length +
      filters.employeeRanges.length +
      filters.locations.length +
      filters.jobTitles.length +
      filters.hiringTitles.length +
      (filters.revenueMin > 0 ? 1 : 0),
    [filters],
  );

  const canSearch = activeFilterCount > 0;

  async function searchCompanies() {
    if (!canSearch) {
      return;
    }

    setSearchState("loading");
    setError(null);

    const limit = clampLimitInput(limitInput);
    setLimitInput(String(limit));

    try {
      const response = await fetch("/api/company-search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filters,
          limit,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Company search failed");
      }

      setResults(data as CompanySearchResponse);
      setSearchState("success");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Company search failed",
      );
      setSearchState("error");
    }
  }

  function toggleFilter(groupKey: ToggleGroupKey, value: string) {
    setFilters((current) => {
      const currentValues = current[groupKey];
      const nextValues = currentValues.includes(value)
        ? currentValues.filter((item) => item !== value)
        : [...currentValues, value];

      return {
        ...current,
        [groupKey]: nextValues,
      };
    });
  }

  function addFilterValue(groupKey: ToggleGroupKey, value: string) {
    const trimmed = value.trim();

    if (!trimmed) {
      return;
    }

    setFilters((current) =>
      current[groupKey].includes(trimmed)
        ? current
        : { ...current, [groupKey]: [...current[groupKey], trimmed] },
    );
    setDrafts((current) => ({ ...current, [groupKey]: "" }));
  }

  function addCustomValue(groupKey: ToggleGroupKey) {
    addFilterValue(groupKey, drafts[groupKey] ?? "");
  }

  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    setLimitInput(String(DEFAULT_COMPANY_LIMIT));
    setDrafts({});
  }

  const skeletonCount = clampLimitInput(limitInput);

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-6 text-foreground sm:px-6 sm:py-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 sm:gap-8">
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:rounded-3xl sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="flex items-center gap-2 text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
                <Building2 className="size-4" aria-hidden="true" />
                Mural Pay Admin
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                Company Discovery
              </h1>
              <p className="mt-3 text-base leading-7 text-muted-foreground">
                Find companies that match your ICP, review fit signals, and
                decide which accounts deserve deeper research.
              </p>
              <Link
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground"
                href="/icp"
              >
                <Wand2 className="size-4" aria-hidden="true" />
                Start from example companies instead
              </Link>
            </div>
            <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-border bg-muted px-5 py-4">
              <Filter className="size-5 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="text-sm text-muted-foreground">Active filters</p>
                <p className="text-3xl font-semibold tabular-nums text-foreground">
                  {activeFilterCount}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[340px_1fr] lg:items-start">
          <aside className="lg:sticky lg:top-6">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:rounded-3xl sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    ICP filters
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Toggle presets before searching.
                  </p>
                </div>
                {activeFilterCount > 0 ? (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                    Reset
                  </button>
                ) : null}
              </div>

              <div className="mt-6 flex flex-col gap-6">
                {FILTER_GROUPS.map((group) => {
                  const customValues = filters[group.key].filter(
                    (value) =>
                      !group.options.some((option) => option.value === value),
                  );
                  const chips = [
                    ...group.options,
                    ...customValues.map((value) => ({ value, label: value })),
                  ];

                  return (
                    <div key={group.key}>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {group.label}
                      </h3>
                      {chips.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {chips.map((option) => {
                            const selected = filters[group.key].includes(
                              option.value,
                            );

                            return (
                              <button
                                key={option.value}
                                type="button"
                                aria-pressed={selected}
                                onClick={() =>
                                  toggleFilter(group.key, option.value)
                                }
                                className={cn(
                                  chipBase,
                                  selected
                                    ? "border-foreground bg-foreground text-background"
                                    : "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:bg-muted",
                                )}
                              >
                                {option.label}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      {group.allowCustom ? (
                        <div className="mt-3">
                          <input
                            className={cn(inputClass, "text-sm")}
                            placeholder={
                              group.key === "hiringTitles"
                                ? "Type a role and press Enter"
                                : "Type a title and press Enter"
                            }
                            value={drafts[group.key] ?? ""}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [group.key]: event.target.value,
                              }))
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                addCustomValue(group.key);
                              }
                            }}
                          />
                          {group.suggestions ? (
                            <SuggestionChips
                              suggestions={group.suggestions}
                              query={drafts[group.key] ?? ""}
                              selected={filters[group.key]}
                              onSelect={(value) =>
                                addFilterValue(group.key, value)
                              }
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}

                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Min revenue ($M)
                  </span>
                  <input
                    className={cn(inputClass, "mt-3")}
                    min={0}
                    placeholder="Blank = no floor"
                    type="number"
                    value={
                      filters.revenueMin > 0 ? filters.revenueMin / 1_000_000 : ""
                    }
                    onChange={(event) => {
                      const millions = Number(event.target.value);

                      setFilters((current) => ({
                        ...current,
                        revenueMin:
                          Number.isFinite(millions) && millions > 0
                            ? millions * 1_000_000
                            : 0,
                      }));
                    }}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {filters.revenueMin > 0
                      ? `Revenue minimum: ${formatCurrency(filters.revenueMin)}`
                      : "Off — includes companies without revenue data"}
                  </p>
                  <SuggestionChips
                    suggestions={REVENUE_SUGGESTIONS_MILLIONS.map(String)}
                    selected={
                      filters.revenueMin > 0
                        ? [String(filters.revenueMin / 1_000_000)]
                        : []
                    }
                    onSelect={(value) =>
                      setFilters((current) => ({
                        ...current,
                        revenueMin: Number(value) * 1_000_000,
                      }))
                    }
                    formatLabel={(value) => `$${value}M`}
                    allowReselect
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Number of companies (max {MAX_COMPANY_LIMIT})
                  </span>
                  <input
                    className={cn(inputClass, "mt-3")}
                    min={1}
                    max={MAX_COMPANY_LIMIT}
                    type="number"
                    value={limitInput}
                    onChange={(event) => setLimitInput(event.target.value)}
                    onBlur={() => {
                      const clamped = clampLimitInput(limitInput);
                      setLimitInput(String(clamped));
                    }}
                  />
                </label>

                <Button
                  className="h-11 w-full cursor-pointer rounded-xl"
                  disabled={!canSearch || searchState === "loading"}
                  onClick={searchCompanies}
                >
                  {searchState === "loading" ? (
                    <>
                      <Loader2
                        className="size-4 animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                      Searching...
                    </>
                  ) : (
                    <>
                      <Search className="size-4" aria-hidden="true" />
                      Search Companies
                    </>
                  )}
                </Button>
              </div>
            </div>
          </aside>

          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:rounded-3xl sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  Companies
                </h2>
                <p className="text-sm text-muted-foreground">
                  Results ranked by ICP fit and buying signals.
                </p>
              </div>
              {results ? (
                <p className="text-sm tabular-nums text-muted-foreground">
                  Showing {results.returnedCount} of {results.requestedLimit}{" "}
                  requested
                </p>
              ) : null}
            </div>

            <div className="mt-6">
              {searchState === "idle" ? (
                <EmptyState
                  icon={Search}
                  message="Set filters and search to see company matches."
                  action={
                    <Button
                      className="cursor-pointer"
                      disabled={!canSearch}
                      onClick={searchCompanies}
                    >
                      <Search className="size-4" aria-hidden="true" />
                      Run search
                    </Button>
                  }
                />
              ) : null}
              {searchState === "loading" ? (
                <LoadingSkeleton count={skeletonCount} />
              ) : null}
              {searchState === "error" ? (
                <ErrorState message={error ?? "Company search failed"} />
              ) : null}
              {searchState === "success" && results?.companies.length === 0 ? (
                <EmptyState
                  icon={Filter}
                  message="No companies matched these filters."
                  hint="Try broadening the ICP chips or turning off the revenue floor."
                  action={
                    <Button
                      variant="outline"
                      className="cursor-pointer"
                      onClick={resetFilters}
                    >
                      Clear all filters
                    </Button>
                  }
                />
              ) : null}
              {searchState === "success" &&
              results &&
              results.companies.length > 0 ? (
                <CompanyResults
                  companies={results.companies}
                  requestedLimit={results.requestedLimit}
                />
              ) : null}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

function CompanyResults({
  companies,
  requestedLimit,
}: {
  companies: DiscoveredCompany[];
  requestedLimit: number;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (companies.length > 0) {
      setExpandedIds(new Set([companies[0].id]));
    } else {
      setExpandedIds(new Set());
    }
  }, [companies]);

  function toggleExpanded(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="mb-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          {companies.length} result{companies.length === 1 ? "" : "s"}
          {companies.length < requestedLimit
            ? ` of ${requestedLimit} requested`
            : ""}
        </h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit cursor-pointer"
          onClick={() => exportCompaniesToExcel(companies)}
        >
          <Download className="size-4" aria-hidden="true" />
          Export Excel
        </Button>
      </div>
      {companies.map((company, index) => (
        <CompanyCard
          key={company.id}
          company={company}
          expanded={expandedIds.has(company.id)}
          index={index}
          onToggle={() => toggleExpanded(company.id)}
        />
      ))}
    </div>
  );
}

function CompanyCard({
  company,
  expanded,
  index,
  onToggle,
}: {
  company: DiscoveredCompany;
  expanded: boolean;
  index: number;
  onToggle: () => void;
}) {
  const matchedSignals = company.signals
    .filter((signal) => signal.matched)
    .map((signal) => signal.label);
  const previewSignals = matchedSignals.slice(0, 2);

  return (
    <article
      className={cn(
        "rounded-xl border bg-card transition-colors duration-200",
        expanded
          ? "border-border shadow-sm"
          : "border-border hover:border-foreground/20 hover:bg-muted/40",
      )}
    >
      <div className="flex items-stretch">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-4 py-3 text-left outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:gap-4 sm:px-5 sm:py-3.5"
        >
          <span className="shrink-0 tabular-nums text-sm text-muted-foreground">
            {index + 1}.
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-foreground">
              {company.name}
            </p>
            {company.domain ? (
              <p className="truncate text-xs text-muted-foreground">
                {company.domain}
              </p>
            ) : null}
            {!expanded && previewSignals.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {previewSignals.map((signal) => (
                  <span
                    key={signal}
                    className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                  >
                    {signal}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <FitBadge fit={company.fit} />
            <span className="text-sm font-medium tabular-nums text-foreground">
              {Math.round(company.score * 100)}%
            </span>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                expanded && "rotate-180",
              )}
              aria-hidden="true"
            />
          </div>
        </button>
        {company.websiteUrl ? (
          <a
            className="flex shrink-0 cursor-pointer items-center border-l border-border px-3 text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-4"
            href={company.websiteUrl}
            rel="noreferrer"
            target="_blank"
            title="Open website"
            onClick={(event) => event.stopPropagation()}
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            <span className="sr-only">Open {company.name} website</span>
          </a>
        ) : null}
      </div>

      {expanded ? (
        <div className="border-t border-border px-4 pb-5 pt-4 sm:px-5">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(0,160px)_1fr]">
            <CompanyField label="Website">
              {company.websiteUrl ? (
                <a
                  className="inline-flex cursor-pointer items-center gap-1 text-foreground underline-offset-2 transition-colors duration-200 hover:underline"
                  href={company.websiteUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {company.domain ?? company.websiteUrl}
                  <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                </a>
              ) : (
                <MissingValue />
              )}
            </CompanyField>
            <CompanyField label="Revenue">
              {company.revenueDisplay ??
                formatNullableCurrency(company.annualRevenue)}
            </CompanyField>
            <CompanyField label="Founded">
              {company.foundedYear ?? <MissingValue />}
            </CompanyField>
            <CompanyField label="Phone">
              {company.phone ?? <MissingValue />}
            </CompanyField>
            <CompanyField label="LinkedIn">
              {company.linkedinUrl ? (
                <a
                  className="inline-flex cursor-pointer items-center gap-1 text-foreground underline-offset-2 transition-colors duration-200 hover:underline"
                  href={company.linkedinUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {company.linkedinUrl.replace(/^https?:\/\//, "")}
                  <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
                </a>
              ) : (
                <MissingValue />
              )}
            </CompanyField>
            <CompanyField label="12mo headcount growth">
              {company.headcountGrowthTwelveMonths !== null ? (
                formatPercent(company.headcountGrowthTwelveMonths)
              ) : (
                <MissingValue />
              )}
            </CompanyField>
          </dl>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Buying signals
            </p>
            <div className="mt-2">
              <BadgeList
                values={matchedSignals}
                emptyLabel="No matched signals"
              />
            </div>
          </div>

          {company.llmReason ? (
            <div className="mt-4 rounded-lg border border-border bg-muted/50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Sparkles className="size-3.5" aria-hidden="true" />
                AI ICP judgment
                {company.llmScore !== null
                  ? ` (${Math.round(company.llmScore * 100)}/100)`
                  : ""}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-foreground">
                {company.llmReason}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function CompanyField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="text-foreground">{children}</dd>
    </>
  );
}

function MissingValue() {
  return <span className="text-muted-foreground/60">Missing</span>;
}

function BadgeList({
  values,
  emptyLabel = "None",
}: {
  values: string[];
  emptyLabel?: string;
}) {
  if (values.length === 0) {
    return <span className="text-sm text-muted-foreground">{emptyLabel}</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span
          key={value}
          className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground"
        >
          {value}
        </span>
      ))}
    </div>
  );
}

function FitBadge({ fit }: { fit: DiscoveredCompany["fit"] }) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-semibold",
        fit === "Strong" && "bg-emerald-100 text-emerald-700",
        fit === "Medium" && "bg-amber-100 text-amber-800",
        fit === "Weak" && "bg-muted text-muted-foreground",
      )}
    >
      {fit}
    </span>
  );
}

function LoadingSkeleton({ count }: { count: number }) {
  const rows = Math.min(count, 8);

  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading results">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 sm:gap-4 sm:px-5"
        >
          <Skeleton className="h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
          <Skeleton className="h-4 w-10 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  message,
  hint,
  action,
}: {
  icon: typeof Search;
  message: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{message}</p>
        {hint ? (
          <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
      <AlertCircle
        className="mt-0.5 size-5 shrink-0 text-red-600"
        aria-hidden="true"
      />
      <div>
        <p className="text-sm font-medium text-red-800">Search failed</p>
        <p className="mt-1 text-sm text-red-700">{message}</p>
      </div>
    </div>
  );
}

function SuggestionChips({
  suggestions,
  query = "",
  selected = [],
  onSelect,
  formatLabel,
  allowReselect = false,
}: {
  suggestions: string[];
  query?: string;
  selected?: string[];
  onSelect: (value: string) => void;
  formatLabel?: (value: string) => string;
  allowReselect?: boolean;
}) {
  const normalizedQuery = query.trim().toLowerCase();

  const visible = suggestions.filter((suggestion) => {
    if (!allowReselect && selected.includes(suggestion)) {
      return false;
    }

    if (
      normalizedQuery &&
      !suggestion.toLowerCase().includes(normalizedQuery)
    ) {
      return false;
    }

    return true;
  });

  if (visible.length === 0) {
    return null;
  }

  return (
    <div className="mt-2">
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Suggestions
      </p>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((suggestion) => {
          const isSelected = selected.includes(suggestion);

          return (
            <button
              key={suggestion}
              type="button"
              onClick={() => onSelect(suggestion)}
              className={cn(
                suggestionChipClass,
                isSelected &&
                  "border-foreground bg-foreground text-background",
              )}
            >
              {formatLabel?.(suggestion) ?? suggestion}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNullableCurrency(value: number | null) {
  return value === null ? "Missing" : formatCurrency(value);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  }).format(value);
}

function exportCompaniesToExcel(companies: DiscoveredCompany[]) {
  const rows = buildCompanyExportRows(companies);

  if (rows.length === 0) {
    return;
  }

  const headers = Object.keys(rows[0]);
  const worksheet = [
    headers,
    ...rows.map((row) =>
      headers.map((header) => row[header as keyof typeof row]),
    ),
  ];
  const html = `<!doctype html><html><head><meta charset="utf-8" /></head><body><table>${worksheet
    .map(
      (row) =>
        `<tr>${row
          .map((cell) => `<td>${escapeSpreadsheetCell(cell)}</td>`)
          .join("")}</tr>`,
    )
    .join("")}</table></body></html>`;
  const blob = new Blob([html], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `mural-company-discovery-top-${rows.length}-${formatDateForFilename(
    new Date(),
  )}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function escapeSpreadsheetCell(value: string | number) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDateForFilename(date: Date) {
  return date.toISOString().slice(0, 10);
}

function clampLimitInput(value: string): number {
  const parsed = parseInt(value.trim(), 10);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_COMPANY_LIMIT;
  }

  return Math.min(MAX_COMPANY_LIMIT, Math.max(1, parsed));
}
