export type CheckInSourceLabel = "QR" | "ADMIN_MANUAL" | "LOCAL_SYNC" | null | undefined;

export function sourceLabel(source: CheckInSourceLabel): string {
  if (source === "QR") return "QR";
  if (source === "ADMIN_MANUAL") return "관리자";
  if (source === "LOCAL_SYNC") return "로컬";
  return "—";
}
