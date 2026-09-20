import Link from "next/link";
import { CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";

type HelpButtonProps = {
  showLabel?: boolean;
  role?: "student" | "teacher";
  className?: string;
};

export function HelpButton({ showLabel = false, className, role = "student" }: HelpButtonProps) {
  const label = role === "teacher" ? "교사 사용 안내" : "학생 사용 안내";
  return (
    <Link
      href={`/help/${role}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={`${label} (새 탭)`}
      className={cn(
        "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
    >
      <CircleHelp className="h-5 w-5 shrink-0" aria-hidden="true" />
      {showLabel && <span>{label}</span>}
    </Link>
  );
}
