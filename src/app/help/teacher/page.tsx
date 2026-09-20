import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { GuideGallery } from "@/components/guide/GuideGallery";
import { GuideVideo } from "@/components/guide/GuideVideo";
import { chapters, TEACHER_VIDEO_ID, TEACHER_VIDEO_URL } from "./content";

export const metadata: Metadata = {
  title: "교사 · 담임교사 사용 안내",
  description: "포산밀 앱 설치, 개인정산과 근무, 체크인 기록, 담임교사의 학생관리·QR출력·신청현황과 얼굴 등록 안내.",
  alternates: { canonical: "/help/teacher" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 5 };

export default function TeacherHelpPage() {
  return <div className="flex h-dvh flex-col overflow-hidden bg-background">
    <a href="#guide-content" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:p-3">안내 본문으로 건너뛰기</a>
    <header className="header-gradient text-white flex shrink-0 items-center justify-between gap-2 border-b px-2 py-2 lg:px-4"><BrandMark label="PosanMeal" className="min-h-11 whitespace-nowrap"/><Link href="/teacher" className="inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-sm hover:bg-muted">교사 화면</Link></header>
    <main className="min-h-0 flex-1 overflow-y-auto px-2 py-3 md:px-3 lg:px-6" id="guide-content">
      <article className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-10">
        <div><p className="text-sm font-medium text-orange-800">교사 · 담임교사</p><h1 className="mt-2 break-keep text-2xl font-bold sm:text-3xl">포산밀 사용 안내</h1><p className="mt-3 break-keep leading-relaxed text-muted-foreground">앱 설치부터 정산 구분과 식사 기록 확인, 우리 반 학생 관리까지 알아보세요. 화면의 이름과 기록은 안내용 가상 예시입니다.</p></div>
        <nav aria-label="안내 목차" className="grid grid-cols-2 gap-2 sm:grid-cols-4">{chapters.map(c=><a key={c.id} href={`#${c.id}`} className="flex min-h-11 items-center justify-center whitespace-nowrap rounded-xl border px-2 text-sm hover:bg-muted">{c.title}</a>)}</nav>
        <GuideVideo videoId={TEACHER_VIDEO_ID} videoUrl={TEACHER_VIDEO_URL}
          audience="교사 · 담임교사" poster="/guide/teacher/Intro.webp" durationLabel="약 5분 26초"
          chapters={chapters.map((chapter, index) => ({ title: chapter.title, startSeconds: index === 0 ? 0 : chapter.steps[0].startSeconds }))} />
        {chapters.map(chapter=><section key={chapter.id} id={chapter.id} className="scroll-mt-4"><h2 className="mb-4 break-keep text-xl font-bold">{chapter.title}</h2><div className="grid gap-5">{chapter.steps.map(step=><section key={step.id} id={step.id} className="min-w-0 rounded-2xl border bg-card p-3 sm:p-4"><h3 className="mb-3 break-keep text-lg font-semibold">{step.title}</h3><a href={`${TEACHER_VIDEO_URL}?t=${step.startSeconds}`} target="_blank" rel="noopener noreferrer" className="mb-3 inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-2 text-sm text-orange-800 hover:bg-orange-50">영상 {Math.floor(step.startSeconds / 60)}:{String(step.startSeconds % 60).padStart(2, "0")}부터 보기</a><div className="mb-4 grid gap-2">{step.paragraphs.map(text=><p key={text} className="break-keep text-sm leading-7 sm:text-base">{text}</p>)}</div><GuideGallery basePath="/guide/teacher" images={step.images.map(file=>({file:`${file}.webp`,alt:`${step.title} 화면 예시`,caption:step.title,width:1280,height:720}))}/></section>)}</div></section>)}
        <Link href="/help/student" className="inline-flex min-h-11 items-center whitespace-nowrap text-sm underline">학생 사용 안내 보기</Link>
      </article>
    </main>
  </div>;
}
