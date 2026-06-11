import type { Metadata } from "next";
import { TickerDetailsView } from "@/components/TickerDetailsView";

export const metadata: Metadata = {
  title: "LITE Details",
};

export default function LiteDetailsPage() {
  return <TickerDetailsView />;
}
