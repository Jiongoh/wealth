const DISPLAY_LOCALE = "en-US";
const DEFAULT_TIMEZONE = "Asia/Taipei";

const DISPLAY_TIMEZONE =
  process.env.NEXT_PUBLIC_APP_TIMEZONE ?? process.env.APP_TIMEZONE ?? DEFAULT_TIMEZONE;

function dateFromDisplayValue(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
}

function formatDate(date: Date, options: Intl.DateTimeFormatOptions): string | null {
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  try {
    return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
      timeZone: DISPLAY_TIMEZONE,
      ...options,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
      timeZone: DEFAULT_TIMEZONE,
      ...options,
    }).format(date);
  }
}

export function formatDisplayDate(value: string | null | undefined): string {
  if (!value) {
    return "--";
  }

  return (
    formatDate(dateFromDisplayValue(value), {
      year: "numeric",
      month: "short",
      day: "numeric",
    }) ?? value
  );
}

export function formatDisplayDateTime(value: string | null | undefined): string {
  if (!value) {
    return "--";
  }

  return (
    formatDate(new Date(value), {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }) ?? value
  );
}

export function formatDisplayTime(value: string | null | undefined): string {
  if (!value) {
    return "--";
  }

  return (
    formatDate(new Date(value), {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }) ?? value
  );
}

export function formatShortDisplayDate(value: string | null | undefined): string {
  if (!value) {
    return "--";
  }

  return (
    formatDate(dateFromDisplayValue(value), {
      month: "short",
      day: "numeric",
    }) ?? value
  );
}
