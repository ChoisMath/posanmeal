import Link from "next/link";
import { CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";

type HelpButtonProps = {
  showLabel?: boolean;
  className?: string;
};

export function HelpButton({ showLabel = false, className }: HelpButtonProps) {
  return (
    <Link
      href="/help/student"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="학생 사용 안내"
      title="학생 사용 안내 (새 탭)"
      className={cn(
        "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
    >
      <CircleHelp className="h-5 w-5 shrink-0" aria-hidden="true" />
      {showLabel && <span>학생 사용 안내</span>}
    </Link>
  );
}
