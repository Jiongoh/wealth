import type { Metadata } from "next";
import { LotsView } from "@/components/LotsView";

export const metadata: Metadata = {
  title: "Lots",
};

type LotsPageProps = {
  searchParams: Promise<{ symbol?: string | string[]; from?: string | string[] }>;
};

export default async function LotsPage({ searchParams }: LotsPageProps) {
  const params = await searchParams;
  const requestedSymbol = Array.isArray(params.symbol) ? params.symbol[0] : params.symbol;
  const requestedFrom = Array.isArray(params.from) ? params.from[0] : params.from;
  const symbol = requestedSymbol?.trim().toUpperCase() || undefined;
  const from = requestedFrom === "watchlist" || requestedFrom === "positions" ? requestedFrom : undefined;

  return <LotsView from={from} symbol={symbol} />;
}
