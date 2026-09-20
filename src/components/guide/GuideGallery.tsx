import Image from "next/image";
import { Expand } from "lucide-react";

type GuideImage = { file: string; alt: string; caption: string; width: number; height: number };

export function GuideGallery({ images, basePath = "/guide/student" }: { images: GuideImage[]; basePath?: string }) {
  return (
    <div className="flex min-w-0 snap-x snap-proximity gap-3 overflow-x-auto rounded-xl pb-2" aria-label="안내 화면 예시">
      {images.map((image) => {
        const portrait = image.height > image.width;
        const src = `${basePath}/${image.file}`;
        return (
          <a key={image.file} href={src} target="_blank" rel="noopener noreferrer" aria-label={`${image.caption} 크게 보기 (새 탭)`}
            className={`group min-h-11 min-w-11 shrink-0 snap-start overflow-hidden rounded-xl border bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-orange-600 ${portrait ? "w-[200px] sm:w-[220px]" : "w-[min(82vw,520px)]"}`}>
            <figure>
              <div className={`flex items-center justify-center p-2 ${portrait ? "h-[380px] sm:h-[420px]" : "h-[220px] sm:h-[260px]"}`}>
                <Image src={src} alt={image.alt} width={image.width} height={image.height} unoptimized
                  className="h-full w-full object-contain" />
              </div>
              <figcaption className="flex min-h-11 items-center justify-between gap-2 border-t bg-white px-3 py-2 text-xs">
                <span className="break-keep leading-relaxed">{image.caption}</span>
                <Expand className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-orange-700" aria-hidden="true" />
              </figcaption>
            </figure>
          </a>
        );
      })}
    </div>
  );
}
