"use client";

import { useState } from "react";
import Image from "next/image";
import { ExternalLink, Play } from "lucide-react";

type VideoChapter = { title: string; startSeconds: number };

export function GuideVideo({ videoId, videoUrl, chapters, audience = "학생", poster = "/guide/student/00-intro.webp", durationLabel = "약 6분 30초" }: {
  audience?: string;
  poster?: string;
  durationLabel?: string;
  videoId: string;
  videoUrl: string;
  chapters: VideoChapter[];
}) {
  const [playback, setPlayback] = useState<{ start: number; revision: number } | null>(null);
  const playFrom = (start: number) => setPlayback((current) => ({
    start,
    revision: (current?.revision ?? 0) + 1,
  }));

  return (
    <section id="guide-video" aria-label={`${audience} 안내 영상`} className="min-w-0 scroll-mt-4">
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="relative aspect-video bg-slate-900">
          {playback ? (
            <iframe
              key={playback.revision}
              src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0&start=${playback.start}`}
              title={`포산밀 ${audience} 사용 안내 영상`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className="absolute inset-0 h-full w-full border-0"
            />
          ) : (
            <button
              type="button"
              onClick={() => playFrom(0)}
              aria-label={`${audience} 안내 영상 재생`}
              className="group absolute inset-0 min-h-11 min-w-11 cursor-pointer focus-visible:outline-4 focus-visible:outline-offset-[-4px] focus-visible:outline-orange-600"
            >
              <Image
                src={poster}
                alt={`포산밀 ${audience} 사용안내 영상 표지`}
                fill
                sizes="(min-width: 1024px) 720px, 100vw"
                unoptimized
                preload
                className="object-contain"
              />
              <span className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors group-hover:bg-black/20">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-600 text-white shadow-lg sm:h-20 sm:w-20">
                  <Play className="ml-1 h-8 w-8 fill-current" aria-hidden="true" />
                </span>
              </span>
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
          <span className="whitespace-nowrap text-sm font-medium">영상으로 먼저 보기 · {durationLabel}</span>
          <a href={videoUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-sm text-orange-800 hover:bg-orange-50 focus-visible:outline-2 focus-visible:outline-orange-600">
            YouTube에서 보기 <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 md:grid-cols-4" aria-label="영상 구간 선택">
        {chapters.map((chapter) => (
          <button key={chapter.title} type="button" onClick={() => playFrom(chapter.startSeconds)}
            aria-label={`${chapter.title} 영상 재생`}
            className="flex min-h-11 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border bg-card px-2 py-2 text-xs font-medium hover:border-orange-400 hover:bg-orange-50 focus-visible:outline-2 focus-visible:outline-orange-600 sm:text-sm">
            <Play className="h-3.5 w-3.5 shrink-0 text-orange-700" aria-hidden="true" />
            {chapter.title}
          </button>
        ))}
      </div>
      <p className="mt-2 break-keep text-xs leading-relaxed text-muted-foreground">재생이 안 되면 ‘YouTube에서 보기’를 눌러 주세요. 아래에서 화면별 설명도 확인할 수 있어요.</p>
    </section>
  );
}
