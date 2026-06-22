"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HandDrawnDivider } from "@/components/HandDrawnDivider";
import {
  CashIcon,
  DashboardIcon,
  PositionsIcon,
  SyncIcon,
  TradesIcon,
  WatchlistIcon,
} from "@/components/NavIcons";

type NavItem = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  /** Render a hand-drawn divider above this item. */
  dividerBefore?: boolean;
};

const navigation: NavItem[] = [
  { label: "Dashboard", href: "/", icon: DashboardIcon },
  { label: "Positions", href: "/positions", icon: PositionsIcon },
  { label: "Watchlist", href: "/watchlist", icon: WatchlistIcon },
  { label: "Trades", href: "/trades", icon: TradesIcon },
  { label: "Cash", href: "/cash", icon: CashIcon },
  { label: "Sync", href: "/sync", icon: SyncIcon, dividerBefore: true },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="nav-list" aria-label="Primary navigation">
      {navigation.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;

        return (
          <div className="nav-item" key={item.href}>
            {item.dividerBefore ? <HandDrawnDivider className="nav-divider" /> : null}
            <Link
              aria-current={active ? "page" : undefined}
              className={`nav-link${active ? " nav-link-active" : ""}`}
              href={item.href}
            >
              <span className="nav-dot" aria-hidden="true" />
              <Icon className="nav-link-icon" />
              <span className="nav-label">{item.label}</span>
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
