import { auth, signIn } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ShieldCheck, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandMark } from "@/components/BrandMark";

export default async function HomePage() {
  const session = await auth();

  if (session?.user) {
    const role = session.user.role;
    if (role === "STUDENT") redirect("/student");
    if (role === "TEACHER") redirect("/teacher");
    if (role === "ADMIN") redirect("/admin");
  }

  return (
    <div className="min-h-screen bg-warm-subtle flex flex-col">
      <BrandMark variant="floating" label="PosanMeal" />
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      {/* Hero gradient area */}
      <div className="bg-warm-gradient flex-1 flex flex-col items-center justify-center px-6 pb-16 pt-20 relative overflow-hidden">
        <div className="absolute -top-20 -right-20 w-60 h-60 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-10 -left-10 w-40 h-40 rounded-full bg-white/10 blur-xl" />

        <div className="relative z-10 text-center text-white">
          <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-sm rounded-full px-4 py-1.5 mb-6 text-sm font-medium">
            <span className="w-2 h-2 rounded-full bg-green-300 animate-pulse" />
            SMART-QR 석식 관리
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight mb-2">포산고등학교</h1>
          <p className="text-white/80 text-lg">석식 체크인 시스템</p>
        </div>
      </div>

      {/* Login card — overlaps gradient */}
      <div className="relative -mt-10 px-6 pb-10">
        <div className="max-w-sm mx-auto glass rounded-2xl card-elevated p-6 space-y-5 page-enter">
          <form
            action={async () => {
              "use server";
              await signIn("google");
            }}
          >
            <Button type="submit" className="w-full h-12 text-base font-semibold rounded-xl" size="lg">
              <svg className="w-5 h-5 mr-2.5 shrink-0" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Google로 로그인
            </Button>
          </form>

        </div>

        {/* Admin login shortcut */}
        <div className="max-w-sm mx-auto mt-4 page-enter">
          <Link
            href="/admin"
            className="group block glass rounded-2xl card-elevated p-4 transition-all hover:scale-[1.015] active:scale-[0.99]"
          >
            <div className="flex items-center gap-4">
              <div className="shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500/25 to-orange-500/15 dark:from-amber-400/30 dark:to-orange-400/20 flex items-center justify-center ring-1 ring-amber-500/20">
                <ShieldCheck className="h-6 w-6 text-amber-600 dark:text-amber-300" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm tracking-tight">관리자로 로그인</p>
                <p className="text-xs text-muted-foreground mt-0.5">관리자 페이지로 이동</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 group-hover:translate-x-0.5 group-hover:text-amber-600 dark:group-hover:text-amber-300 transition-all" />
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
