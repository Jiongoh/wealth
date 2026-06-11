import type { Metadata } from "next";
import { PositionsView } from "@/components/PositionsView";

export const metadata: Metadata = {
  title: "Positions",
};

export default function PositionsPage() {
  return <PositionsView />;
}
