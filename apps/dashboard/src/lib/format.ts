const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
  timeZone: "UTC",
  timeZoneName: "short",
  year: "numeric",
});

const languageNames = new Intl.DisplayNames(["en"], { fallback: "code", type: "language" });

/** Dates render identically on the server and in the browser, so hydration never disagrees. */
export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateFormatter.format(date);
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateTimeFormatter.format(date);
}

export function formatRelative(value: string | null, now: Date): string {
  if (!value) return "Never";
  const elapsed = now.getTime() - Date.parse(value);
  if (Number.isNaN(elapsed)) return "Unknown";
  const minutes = Math.round(elapsed / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return formatDate(value);
}

export function languageName(code: string | null): string {
  if (!code) return "Not set";
  try {
    return languageNames.of(code) ?? code;
  } catch {
    return code;
  }
}

export function providerLabel(provider: string): string {
  switch (provider) {
    case "mymemory":
      return "MyMemory";
    case "nvidia":
      return "NVIDIA";
    case "google":
      return "Google";
    case "on-device":
      return "On-device";
    default:
      return "Unknown";
  }
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString("en")} ${count === 1 ? singular : pluralForm}`;
}
