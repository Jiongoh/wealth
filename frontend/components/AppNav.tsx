"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { label: "Dashboard", href: "/" },
  { label: "Positions", href: "/positions" },
  { label: "Watchlist", href: "/watchlist" },
  { label: "Trades", href: "/trades" },
  { label: "Cash", href: "/cash" },
  { label: "Sync", href: "/sync" },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="nav-list" aria-label="Primary navigation">
      {navigation.map((item) => {
        const active = pathname === item.href;

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`nav-link${active ? " nav-link-active" : ""}`}
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
