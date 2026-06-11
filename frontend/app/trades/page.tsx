import type { Metadata } from "next";
import { TradesView } from "@/components/TradesView";

export const metadata: Metadata = {
  title: "Trades",
};

export default function TradesPage() {
  return <TradesView />;
}
