import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUp, CircleHelp, ExternalLink, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { GuideVideo } from "@/components/guide/GuideVideo";
import { GuideGallery } from "@/components/guide/GuideGallery";
import { guideChapters, STUDENT_VIDEO_ID, STUDENT_VIDEO_URL } from "./content";

const description = "포산밀 학생 안내: 앱 설치와 Google 로그인부터 급식 신청, QR·얼굴 체크인, 식사 기록 확인까지 영상과 화면으로 알아보세요.";

export const metadata: Metadata = {
  title: "학생 사용 안내",
  description,
  alternates: { canonical: "/help/student" },
  openGraph: {
    title: "포산밀 학생 사용 안내",
    description,
    url: "/help/student",
    images: [{ url: "/guide/student/00-intro.webp", width: 1280, height: 720, alt: "포산밀 학생 사용 안내" }],
  },
  twitter: { card: "summary_large_image", title: "포산밀 학생 사용 안내", description, images: ["/guide/student/00-intro.webp"] },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 5 };

const timestamp = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export default function StudentHelpPage() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <a href="#guide-content" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:p-3">안내 본문으로 건너뛰기</a>
      <header className="header-gradient shrink-0">
        <div className="flex items-center justify-between gap-2 px-2 py-2 sm:px-3 lg:mx-auto lg:max-w-6xl lg:px-6">
          <BrandMark variant="header" label="PosanMeal" className="min-h-11 whitespace-nowrap" />
          <Link href="/" className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> 포산밀로
          </Link>
        </div>
      </header>
      <nav aria-label="학생 안내 목차" className="shrink-0 border-b bg-card">
        <div className="flex gap-2 overflow-x-auto px-2 py-1 sm:px-3 lg:mx-auto lg:max-w-6xl lg:px-6">
          {guideChapters.map((chapter, index) => (
            <a key={chapter.id} href={`#${chapter.id}`} className="inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-semibold hover:bg-orange-50 focus-visible:outline-2 focus-visible:outline-orange-600">
              <span className="text-orange-700">0{index + 1}</span>{chapter.title}
            </a>
          ))}
        </div>
      </nav>
      <main id="guide-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-pt-4 focus:outline-none">
        <div className="flex flex-col gap-10 px-2 pb-8 pt-6 sm:px-3 lg:mx-auto lg:max-w-6xl lg:gap-14 lg:px-6 lg:pt-10">
          <section id="guide-top" className="grid min-w-0 gap-6 lg:grid-cols-[0.8fr_1.5fr] lg:items-center">
            <div className="flex flex-col gap-4">
              <span className="text-xs font-bold tracking-[0.18em] text-orange-800">POSANMEAL · STUDENT GUIDE</span>
              <h1 className="break-keep text-3xl font-extrabold leading-tight tracking-tight lg:text-4xl">포산밀<br className="hidden lg:block" /> 학생 사용 안내</h1>
              <p className="break-keep leading-relaxed text-muted-foreground">앱 설치부터 급식 신청, 체크인까지.<br />필요한 내용을 영상과 화면으로 다시 확인하세요.</p>
              <a href="https://meal.posan.kr" className="inline-flex min-h-11 w-fit items-center gap-2 whitespace-nowrap rounded-xl border border-orange-200 bg-orange-50 px-4 py-2 font-bold text-orange-900 focus-visible:outline-2 focus-visible:outline-orange-600">
                meal.posan.kr <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
              <span className="break-keep text-xs text-muted-foreground">학생용 · 로그인 없이 볼 수 있어요.</span>
            </div>
            <GuideVideo videoId={STUDENT_VIDEO_ID} videoUrl={STUDENT_VIDEO_URL}
              chapters={guideChapters.map((chapter, index) => ({ title: chapter.title, startSeconds: index === 0 ? 0 : chapter.steps[0].startSeconds }))} />
          </section>

          <aside className="flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-4">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-orange-800" aria-hidden="true" />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="font-bold text-orange-950">이 세 가지만 꼭 기억하세요</p>
              <p className="break-keep text-sm leading-relaxed text-orange-950">학교에 등록된 내 계정으로 로그인하기. 내 QR은 나만 사용하기. 얼굴 체크인에서는 본인인지 확인한 뒤 확인 누르기.</p>
            </div>
          </aside>

          <p className="break-keep text-sm leading-relaxed text-muted-foreground">여러 화면은 옆으로 넘겨 보세요. 화면을 누르면 새 탭에서 크게 볼 수 있어요.</p>

          {guideChapters.map((chapter, chapterIndex) => (
            <section key={chapter.id} id={chapter.id} aria-labelledby={`${chapter.id}-heading`} className="flex min-w-0 scroll-mt-4 flex-col gap-5">
              <div className="flex items-start gap-3 border-b pb-4">
                <span className="whitespace-nowrap text-3xl font-light text-orange-700">0{chapterIndex + 1}</span>
                <div className="flex min-w-0 flex-col gap-1">
                  <h2 id={`${chapter.id}-heading`} className="whitespace-nowrap text-2xl font-bold tracking-tight">{chapter.title}</h2>
                  <p className="break-keep text-sm leading-relaxed text-muted-foreground">{chapter.description}</p>
                </div>
              </div>
              {chapter.steps.map((step, stepIndex) => {
                const stepNumber = guideChapters.slice(0, chapterIndex).reduce((count, item) => count + item.steps.length, 0) + stepIndex + 1;
                return (
                  <article key={step.id} id={step.id} className="flex min-w-0 scroll-mt-4 flex-col gap-4 rounded-2xl border bg-card p-3 sm:p-4 lg:p-6">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="flex min-w-0 items-start gap-2.5 break-keep text-lg font-bold">
                        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-100 text-sm text-orange-900">{stepNumber}</span>
                        {step.title}
                      </h3>
                      <a href={`${STUDENT_VIDEO_URL}?t=${step.startSeconds}`} target="_blank" rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-xs font-medium text-orange-800 hover:bg-orange-50 focus-visible:outline-2 focus-visible:outline-orange-600">
                        영상 {timestamp(step.startSeconds)}부터 <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    </div>
                    <ol className="flex list-decimal flex-col gap-2 pl-5 marker:text-orange-800">
                      {step.paragraphs.map((paragraph) => <li key={paragraph} className="break-keep pl-1 text-sm leading-7 sm:text-base">{paragraph}</li>)}
                    </ol>
                    {step.notice && (
                      <aside className={`rounded-xl border p-3 ${step.notice.tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-950" : "border-sky-200 bg-sky-50 text-sky-950"}`}>
                        <p className="break-keep text-sm font-bold">{step.notice.title}</p>
                        <p className="mt-1 break-keep text-sm leading-relaxed">{step.notice.body}</p>
                      </aside>
                    )}
                    <GuideGallery images={step.images} />
                  </article>
                );
              })}
            </section>
          ))}

          <footer className="flex flex-col gap-4 rounded-2xl bg-slate-900 p-4 text-white sm:p-6">
            <div className="flex items-center gap-3">
              <CircleHelp className="h-8 w-8 shrink-0 text-orange-300" aria-hidden="true" />
              <h2 className="break-keep text-xl font-bold">궁금할 때는, 다시 여기로</h2>
            </div>
            <p className="break-keep text-sm leading-relaxed text-slate-200">포산밀 화면의 물음표 아이콘을 누르면 이 안내를 다시 볼 수 있어요. 계정이나 신청·식사 기록에 문제가 있으면 담임 선생님께 알려 주세요.</p>
            <p className="break-keep text-xs leading-relaxed text-slate-400">안내 화면의 이름·계정·식단·QR은 설명용 예시입니다. 실제 화면은 공고 내용이나 브라우저 버전에 따라 조금 다를 수 있어요.</p>
            <a href="#guide-top" className="inline-flex min-h-11 w-fit items-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-semibold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white">
              <ArrowUp className="h-4 w-4" aria-hidden="true" /> 맨 위로
            </a>
          </footer>
        </div>
      </main>
    </div>
  );
}
