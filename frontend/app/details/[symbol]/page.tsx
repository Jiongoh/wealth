import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TickerDetailsView } from "@/components/TickerDetailsView";

type DetailsPageProps = {
  params: Promise<{ symbol: string }>;
};

function normalizeSymbol(raw: string): string {
  return decodeURIComponent(raw).trim().toUpperCase();
}

export async function generateMetadata({ params }: DetailsPageProps): Promise<Metadata> {
  const symbol = normalizeSymbol((await params).symbol);
  return { title: symbol ? `${symbol} Details` : "Ticker Details" };
}

export default async function DetailsPage({ params }: DetailsPageProps) {
  const symbol = normalizeSymbol((await params).symbol);
  if (!symbol) {
    notFound();
  }
  return <TickerDetailsView symbol={symbol} />;
}
