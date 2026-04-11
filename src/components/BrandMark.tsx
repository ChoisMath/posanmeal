import Link from "next/link";

interface BrandMarkProps {
  /**
   * "header" — sits inside the amber header-gradient bar (student/teacher/admin).
   *            Uses translucent white chrome so it stands out on the gradient.
   * "floating" — absolute-positioned top-left chip for pages without a header bar
   *              (landing, admin login). Uses glass backdrop so it adapts to any
   *              underlying content.
   * "overlay" — like floating but tuned for the dark/colored /check backgrounds.
   *             Uses the same translucent-black treatment as the existing
   *             "홈으로" back button so the mark reads over camera feed + status
   *             color transitions.
   */
  variant?: "header" | "floating" | "overlay";
  /** Optional wordmark text rendered next to the logo. */
  label?: string;
  /** Override href if the logo should link somewhere other than "/". */
  href?: string;
  /** Extra classes merged onto the outer <Link>. */
  className?: string;
}

const wrapperByVariant: Record<NonNullable<BrandMarkProps["variant"]>, string> = {
  header:
    "inline-flex items-center gap-2.5 -ml-0.5 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent rounded-xl",
  floating:
    "absolute top-4 left-4 z-20 inline-flex items-center gap-2 rounded-full bg-white/70 dark:bg-black/45 backdrop-blur-md px-2.5 py-1.5 ring-1 ring-black/5 dark:ring-white/10 shadow-sm hover:bg-white/90 dark:hover:bg-black/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60",
  overlay:
    "absolute top-4 left-4 z-10 inline-flex items-center gap-2 rounded-full bg-black/40 hover:bg-black/55 text-white backdrop-blur-sm pl-1 pr-3 py-1 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
};

const badgeByVariant: Record<NonNullable<BrandMarkProps["variant"]>, string> = {
  header:
    "relative inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] overflow-hidden",
  floating:
    "relative inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/60 dark:bg-white/10 ring-1 ring-amber-500/15 overflow-hidden",
  overlay:
    "relative inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/90 ring-1 ring-white/40 overflow-hidden",
};

const labelByVariant: Record<NonNullable<BrandMarkProps["variant"]>, string> = {
  header: "font-bold text-base tracking-tight",
  floating: "font-semibold text-sm tracking-tight text-foreground",
  overlay: "tracking-tight",
};

export function BrandMark({
  variant = "header",
  label,
  href = "/",
  className,
}: BrandMarkProps) {
  return (
    <Link
      href={href}
      aria-label={label ? `${label} — 홈` : "포산밀 홈"}
      className={[wrapperByVariant[variant], className].filter(Boolean).join(" ")}
    >
      <span className={badgeByVariant[variant]}>
        {/* meal.ico is a 256x256 Windows icon; Next/Image doesn't handle ICO,
            so we use a plain img. The alt is empty because the adjacent label
            (or the Link's aria-label) already names the element. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/meal.ico"
          alt=""
          width={28}
          height={28}
          className="h-full w-full object-contain"
          draggable={false}
        />
      </span>
      {label && <span className={labelByVariant[variant]}>{label}</span>}
    </Link>
  );
}
