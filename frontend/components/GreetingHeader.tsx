"use client";

import { useEffect, useState } from "react";

const DEFAULT_TIMEZONE = "Asia/Taipei";
const TIMEZONE =
  process.env.NEXT_PUBLIC_APP_TIMEZONE ?? process.env.APP_TIMEZONE ?? DEFAULT_TIMEZONE;

function hourInTimezone(timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone,
  }).format(new Date());

  return Number(hour);
}

function greetingForHour(hour: number): string {
  if (hour >= 5 && hour < 12) {
    return "Good Morning";
  }
  if (hour >= 12 && hour < 18) {
    return "Good Afternoon";
  }
  return "Good Evening";
}

function currentGreeting(): string {
  try {
    return greetingForHour(hourInTimezone(TIMEZONE));
  } catch {
    return greetingForHour(hourInTimezone(DEFAULT_TIMEZONE));
  }
}

export function GreetingHeader() {
  const [greeting, setGreeting] = useState(currentGreeting);

  useEffect(() => {
    setGreeting(currentGreeting());
    const interval = window.setInterval(() => setGreeting(currentGreeting()), 60_000);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="greeting-header">
      <p className="greeting-title">{greeting}, Thomas</p>
      <p className="greeting-subtitle">Here is your latest portfolio snapshot.</p>
    </div>
  );
}
