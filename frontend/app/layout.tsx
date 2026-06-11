import type { Metadata } from "next";
import { AppNav } from "@/components/AppNav";
import { GreetingHeader } from "@/components/GreetingHeader";
import { UserProfileCard } from "@/components/UserProfileCard";
import "./styles.css";

export const metadata: Metadata = {
  title: {
    default: "Dashboard | IBKR Sync",
    template: "%s | IBKR Sync",
  },
  description: "Portfolio and synchronization dashboard for IBKR Flex reports.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <aside className="sidebar">
            <div className="brand">
              <span className="brand-mark" aria-hidden="true">
                IS
              </span>
              <div>
                <p className="brand-title">My Portfolio</p>
                <p className="brand-subtitle">IBKR sync journal</p>
              </div>
            </div>
            <AppNav />
            <UserProfileCard />
          </aside>
          <div className="content-shell">
            <header className="topbar">
              <GreetingHeader />
            </header>
            <main className="page-content">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
