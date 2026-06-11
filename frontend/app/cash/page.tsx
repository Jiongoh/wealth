import type { Metadata } from "next";
import { CashView } from "@/components/CashView";

export const metadata: Metadata = {
  title: "Cash",
};

export default function CashPage() {
  return <CashView />;
}
