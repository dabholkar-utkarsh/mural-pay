"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Loader2,
  Search,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  MAX_EXAMPLE_DOMAINS,
  normalizeDomain,
} from "@mural/company-discovery";
import type {
  DeriveIcpResponse,
  IcpExampleProfile,
} from "@mural/company-discovery";
import { cn } from "@/lib/utils";

// The main search page reads this key on mount and prefills its filters.
export const DERIVED_FILTERS_STORAGE_KEY = "mural.derived-icp-filters";

type DeriveState = "idle" | "loading" | "success" | "error";

const inputClass =
  "w-full rounded-xl border border-input bg-background px-3 py-2 text-foreground outline-none transition-colors duration-200 placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20";

export function DeriveIcpClient() {
  const router = useRouter();
  const [domains, setDomains] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<DeriveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeriveIcpResponse | null>(null);

  function addDraftDomains() {
    // Accept comma/space/newline separated pastes in one go.
    const candidates = draft
      .split(/[\s,]+/)
      .map(normalizeDomain)
      .filter((domain): domain is string => domain !== null);

    if (candidates.length === 0) {
      return;
    }

    setDomains((current) =>
      Array.from(new Set([...current, ...candidates])).slice(
        0,
        MAX_EXAMPLE_DOMAINS,
      ),
    );
    setDraft("");
  }

  function removeDomain(domain: string) {
    setDomains((current) => current.filter((item) => item !== domain));
  }

  async function deriveIcp() {
    if (domains.length === 0) {
      return;
    }

    setState("loading");
    setError(null);

    try {
      const response = await fetch("/api/derive-icp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "ICP derivation failed");
      }

      setResult(data as DeriveIcpResponse);
      setState("success");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "ICP derivation failed",
      );
      setState("error");
    }
  }

  function applyToSearch() {
    if (!result) {
      return;
    }

    sessionStorage.setItem(
      DERIVED_FILTERS_STORAGE_KEY,
      JSON.stringify(result.filters),
    );
    router.push("/");
  }

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-6 text-foreground sm:px-6 sm:py-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 sm:gap-8">
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:rounded-3xl sm:p-8">
          <p className="flex items-center gap-2 text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <Building2 className="size-4" aria-hidden="true" />
            Mural Pay Admin
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Start from example companies
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
            Paste 2-3 domains of companies you wish you had more of. We enrich
            them, work out what they share as Mural Pay prospects, and turn
            that into search filters.
          </p>
          <Link
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground"
            href="/"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to search
          </Link>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:rounded-3xl sm:p-6">
          <h2 className="text-lg font-semibold">
            Example domains ({domains.length}/{MAX_EXAMPLE_DOMAINS})
          </h2>
          {domains.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {domains.map((domain) => (
                <span
                  key={domain}
                  className="inline-flex items-center gap-1.5 rounded-full border border-foreground bg-foreground px-3 py-1.5 text-sm font-medium text-background"
                >
                  {domain}
                  <button
                    type="button"
                    onClick={() => removeDomain(domain)}
                    className="cursor-pointer rounded-full p-0.5 transition-colors duration-200 hover:bg-background/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                    <span className="sr-only">Remove {domain}</span>
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="mt-3 flex gap-2">
            <input
              className={inputClass}
              placeholder="e.g. slash.com, kalshi.com — press Enter"
              value={draft}
              disabled={domains.length >= MAX_EXAMPLE_DOMAINS}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addDraftDomains();
                }
              }}
            />
            <Button
              className="h-auto shrink-0 cursor-pointer rounded-xl"
              variant="outline"
              disabled={
                draft.trim().length === 0 ||
                domains.length >= MAX_EXAMPLE_DOMAINS
              }
              onClick={addDraftDomains}
            >
              Add
            </Button>
          </div>
          <Button
            className="mt-4 h-11 w-full cursor-pointer rounded-xl"
            disabled={domains.length === 0 || state === "loading"}
            onClick={deriveIcp}
          >
            {state === "loading" ? (
              <>
                <Loader2
                  className="size-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
                Analyzing examples...
              </>
            ) : (
              <>
                <Wand2 className="size-4" aria-hidden="true" />
                Derive ICP from examples
              </>
            )}
          </Button>
        </section>

        {state === "error" ? (
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
            <AlertCircle
              className="mt-0.5 size-5 shrink-0 text-red-600"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium text-red-800">
                ICP derivation failed
              </p>
              <p className="mt-1 text-sm text-red-700">{error}</p>
            </div>
          </div>
        ) : null}

        {state === "success" && result ? (
          <>
            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:rounded-3xl sm:p-6">
              <h2 className="text-lg font-semibold">What we found</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {result.examples.map((example) => (
                  <ExampleCard key={example.domain} example={example} />
                ))}
              </div>

              {result.pattern ? (
                <div className="mt-4 rounded-lg border border-border bg-muted/50 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Sparkles className="size-3.5" aria-hidden="true" />
                    The pattern
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed">
                    {result.pattern}
                  </p>
                </div>
              ) : null}

              {result.signals.length > 0 ? (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Shared signals
                  </p>
                  <ul className="mt-2 flex flex-col gap-2">
                    {result.signals.map((signal) => (
                      <li
                        key={signal.label}
                        className="rounded-lg border border-border p-3 text-sm"
                      >
                        <span className="font-medium">{signal.label}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          — {signal.evidence}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:rounded-3xl sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Derived search filters</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Applied to the search page, where you can tweak before
                    running.
                  </p>
                </div>
                <Button className="cursor-pointer" onClick={applyToSearch}>
                  <Search className="size-4" aria-hidden="true" />
                  Apply to search
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Button>
              </div>
              <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(0,160px)_1fr]">
                <FilterRow label="Keywords" values={result.filters.keywords} />
                <FilterRow
                  label="Company size"
                  values={result.filters.employeeRanges.map((range) =>
                    range.replace(",", "-"),
                  )}
                />
                <FilterRow
                  label="Min revenue"
                  values={
                    result.filters.revenueMin > 0
                      ? [`$${result.filters.revenueMin / 1_000_000}M`]
                      : []
                  }
                  emptyLabel="No floor"
                />
                <FilterRow label="Locations" values={result.filters.locations} />
                <FilterRow
                  label="Buyer personas"
                  values={result.filters.jobTitles}
                />
                <FilterRow
                  label="Hiring for"
                  values={result.filters.hiringTitles}
                />
              </dl>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

function ExampleCard({ example }: { example: IcpExampleProfile }) {
  return (
    <article
      className={cn(
        "rounded-xl border p-4",
        example.found
          ? "border-border bg-card"
          : "border-dashed border-border bg-muted/30",
      )}
    >
      <p className="font-semibold">{example.name ?? example.domain}</p>
      <p className="text-xs text-muted-foreground">{example.domain}</p>
      {example.found ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            {[
              example.industry,
              example.employeeCount !== null
                ? `${example.employeeCount} employees`
                : null,
              example.location,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {example.keywords.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {example.keywords.slice(0, 6).map((keyword) => (
                <span
                  key={keyword}
                  className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  {keyword}
                </span>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Not found in Apollo — excluded from the analysis.
        </p>
      )}
    </article>
  );
}

function FilterRow({
  label,
  values,
  emptyLabel = "None",
}: {
  label: string;
  values: string[];
  emptyLabel?: string;
}) {
  return (
    <>
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd>
        {values.length > 0 ? (
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
        ) : (
          <span className="text-muted-foreground/60">{emptyLabel}</span>
        )}
      </dd>
    </>
  );
}
