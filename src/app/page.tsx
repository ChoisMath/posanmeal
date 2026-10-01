import { auth, signIn } from "@/auth";
import { redirect } from "next/navigation";
import { ResetOnQuery } from "@/components/ResetOnQuery";
import { HelpButton } from "@/components/guide/HelpButton";
import { GoogleLoginButton } from "@/components/landing/GoogleLoginButton";
import { LandingScene } from "@/components/landing/LandingScene";
import { LandingWord } from "@/components/landing/LandingWord";
import styles from "@/components/landing/landing.module.css";
import { loginNoticeFor } from "@/lib/login-notice";

const topLinkClass =
  "inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-medium whitespace-nowrap text-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const session = await auth();

  if (session?.user) {
    const role = session.user.role;
    if (role === "STUDENT") redirect("/student");
    if (role === "TEACHER") redirect("/teacher");
    if (role === "ADMIN") redirect("/admin");
  }

  const notice = loginNoticeFor((await searchParams).error);

  return (
    <main className={styles.stage}>
      <ResetOnQuery />
      <LandingScene />
      <LandingWord />

      <nav className={styles.topNav}>
        <HelpButton showLabel className={`${topLinkClass} [&_svg]:size-3.5`} />
        {/* 같은 페이지 안의 <Link> 이동은 ResetOnQuery를 다시 마운트하지 않아 초기화가 실행되지 않는다. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/?reset=1"
          title="앱이 멈췄을 때 이 기기에 저장된 데이터를 지우고 새로 시작합니다"
          className={topLinkClass}
        >
          초기화
        </a>
      </nav>

      <div className={styles.dock}>
        <div className={styles.dockInner}>
          {notice && (
            <div role="alert" className={styles.notice}>
              <p className="font-semibold text-destructive">{notice.title}</p>
              <p className="mt-1 text-muted-foreground">{notice.detail}</p>
            </div>
          )}
          <form
            action={async () => {
              "use server";
              await signIn("google");
            }}
          >
            <GoogleLoginButton />
          </form>
        </div>
      </div>
    </main>
  );
}
