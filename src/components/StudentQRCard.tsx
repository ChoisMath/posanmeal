interface StudentQRCardProps {
  grade: number;
  classNum: number;
  number: number;
  name: string;
  /** qrcode 로 생성한 data URL. 빈 문자열이면 플레이스홀더. */
  qrDataUrl: string;
}

/** 인쇄용 5×5cm(≈47mm) 학생 QR 카드. 화면 미리보기·인쇄에 동일 사용. 치수는 물리 크기 보장을 위해 mm 고정. */
export function StudentQRCard({ grade, classNum, number, name, qrDataUrl }: StudentQRCardProps) {
  return (
    <div
      style={{ width: "47mm", height: "47mm", padding: "2.5mm", boxSizing: "border-box", breakInside: "avoid" }}
      className="flex flex-col items-center justify-between overflow-hidden rounded-[2mm] border border-stone-400 bg-white text-black"
    >
      <div className="flex shrink-0 items-center" style={{ gap: "1.5mm" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/meal.png" alt="" style={{ width: "5mm", height: "5mm" }} className="object-contain" />
        <span style={{ fontSize: "3.6mm" }} className="font-bold tracking-tight">PosanMeal</span>
      </div>

      <div
        style={{ fontSize: "3mm", maxWidth: "42mm" }}
        className="shrink-0 overflow-hidden font-semibold whitespace-nowrap text-ellipsis"
      >
        {grade}학년 {classNum}반 {number}번 {name}
      </div>

      {qrDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={qrDataUrl}
          alt={`${grade}학년 ${classNum}반 ${number}번 ${name} QR 코드`}
          className="shrink-0"
          style={{ width: "30mm", height: "30mm" }}
        />
      ) : (
        <div style={{ width: "30mm", height: "30mm" }} className="shrink-0 bg-stone-100" />
      )}
    </div>
  );
}
