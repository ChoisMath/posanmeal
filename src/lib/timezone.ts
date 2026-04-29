export const TIMEZONE = "Asia/Seoul";

export function nowKST(): Date {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: TIMEZONE })
  );
}

export function todayKST(): string {
  return new Date()
    .toLocaleDateString("en-CA", { timeZone: TIMEZONE });
}

export function formatKST(date: Date): string {
  return date.toLocaleString("ko-KR", { timeZone: TIMEZONE });
}

export function formatDateKST(date: Date): string {
  return date.toLocaleDateString("ko-KR", {
    timeZone: TIMEZONE,
    month: "2-digit",
    day: "2-digit",
  });
}

export function formatTimeKST(date: Date): string {
  return date.toLocaleTimeString("ko-KR", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatDateTimeKST(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}
