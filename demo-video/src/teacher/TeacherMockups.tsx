import React from "react";
import { MockQr, LandingMock } from "../student/StudentMockups";
import { PALETTE as P } from "../student/style";

export const TEACHER = {
  name: "김포산",
  homeroom: "1학년 2반",
  email: "teacher@example.com",
};
const panel: React.CSSProperties = {
  background: P.white,
  padding: 24,
  borderRadius: 18,
  margin: 18,
  boxShadow: `0 4px 20px ${P.shadow}`,
};
export function TeacherMock({
  tab = "QR",
  work = false,
  selected = false,
  detail = false,
}: {
  tab?: string;
  work?: boolean;
  selected?: boolean;
  detail?: boolean;
}) {
  if (tab === "로그인") return <LandingMock />;
  return (
    <div
      style={{
        background: P.paper,
        width: 390,
        height: 752,
        color: P.ink,
        fontSize: 14,
      }}
    >
      <div
        style={{
          background: P.orange,
          color: P.white,
          padding: "18px 15px",
          display: "flex",
          justifyContent: "space-between",
          fontWeight: 700,
        }}
      >
        <span>PosanMeal</span>
        <span>? ↪</span>
      </div>
      <div
        style={{
          display: "flex",
          margin: "16px 8px",
          background: P.line,
          borderRadius: 10,
        }}
      >
        {["식단", "QR", "확인", "학생관리", "신청현황", "개인정보"].map((t) => (
          <div
            key={t}
            style={{
              padding: "12px 6px",
              fontSize: 12,
              whiteSpace: "nowrap",
              background: tab === t ? P.white : undefined,
              borderRadius: 8,
            }}
          >
            {t}
          </div>
        ))}
      </div>
      <div style={panel}>
        {tab === "QR" && (
          <>
            <div
              style={{
                display: "flex",
                background: P.paper,
                padding: 5,
                borderRadius: 12,
                marginBottom: 25,
              }}
            >
              {["개인정산", "근무"].map((t, i) => (
                <div
                  key={t}
                  style={{
                    width: "50%",
                    textAlign: "center",
                    padding: 12,
                    background: work === Boolean(i) ? P.white : undefined,
                    fontWeight: 700,
                    borderRadius: 9,
                  }}
                >
                  {t}
                </div>
              ))}
            </div>
            <MockQr size={294} />
            <p style={{ textAlign: "center", fontWeight: 700 }}>
              {TEACHER.name} 선생님
            </p>
            <p style={{ textAlign: "center", color: work ? P.blue : P.orange }}>
              {work ? "근무" : "개인"} 석식용 QR
            </p>
          </>
        )}
        {tab === "확인" && (
          <>
            <h3>석식 이력</h3>
            <p style={{ textAlign: "center" }}>〈 2026년 9월 〉</p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7,1fr)",
                gap: 4,
              }}
            >
              {[
                "일",
                "월",
                "화",
                "수",
                "목",
                "금",
                "토",
                "",
                "",
                ...Array.from({ length: 30 }, (_, i) => String(i + 1)),
              ].map((d, i) => (
                <div
                  key={i}
                  style={{
                    padding: "14px 0",
                    textAlign: "center",
                    borderRadius: 6,
                    background:
                      i === 24 ? P.blueSoft : i === 25 ? P.greenSoft : P.paper,
                  }}
                >
                  {d}
                  {i === 24 ? (
                    <div style={{ fontSize: 8, color: P.blue }}>근무 18:05</div>
                  ) : i === 25 ? (
                    <div style={{ fontSize: 8, color: P.green }}>
                      석식 18:10
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            <p>석식: 개인정산 기록 · 근무: 근무 기록</p>
          </>
        )}
        {tab === "개인정보" && (
          <>
            <div
              style={{
                textAlign: "center",
                padding: 18,
                background: P.paper,
                borderRadius: 12,
              }}
            >
              프로필 사진
            </div>
            <h3>얼굴등록</h3>
            <p style={{ lineHeight: 1.8 }}>
              얼굴 등록은 선택 사항입니다.
              <br />
              개인정보 수집·이용 안내 확인
              <br />
              동의 후 카메라 허용
            </p>
            <div
              style={{
                background: P.orange,
                color: P.white,
                padding: 14,
                borderRadius: 10,
                textAlign: "center",
              }}
            >
              얼굴 등록
            </div>
            {[
              ["이메일", TEACHER.email],
              ["이름", TEACHER.name],
              ["교과명", "수학"],
              ["담임", TEACHER.homeroom],
            ].map(([k, v]) => (
              <div
                key={k}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "17px 0",
                  borderBottom: `1px solid ${P.line}`,
                }}
              >
                <span>{k}</span>
                <span>{v}</span>
              </div>
            ))}
          </>
        )}
        {tab === "신청현황" && (
          <>
            <h3>{detail ? "9월 급식 신청" : "식사 신청 목록"}</h3>
            {detail ? (
              <>
                <p>〈 목록으로</p>
                <div style={{ background: P.paper, padding: 12 }}>
                  번호_이름 신청시간
                </div>
                {["01_김하늘", "02_이도윤", "03_박서연"].map((n, i) => (
                  <div
                    key={n}
                    style={{ borderBottom: `1px solid ${P.line}`, padding: 14 }}
                  >
                    {n}
                    <br />
                    <small>2026.08.25. 09:{10 + i} 조식·석식</small>
                  </div>
                ))}
              </>
            ) : (
              ["9월 급식 신청", "10월 급식 신청"].map((n) => (
                <div
                  key={n}
                  style={{
                    border: `1px solid ${P.line}`,
                    padding: 20,
                    borderRadius: 12,
                    marginBottom: 15,
                  }}
                >
                  {n} ›
                  <p style={{ fontSize: 12, color: P.muted }}>
                    조식 · 중식 · 석식
                  </p>
                </div>
              ))
            )}
          </>
        )}
        {tab === "식단" && (
          <>
            <h3>오늘의 식단</h3>
            <p>2026년 9월 21일</p>
            {["조식", "중식", "석식"].map((m) => (
              <div
                key={m}
                style={{
                  padding: 20,
                  background: P.paper,
                  marginTop: 12,
                  borderRadius: 10,
                }}
              >
                {m}
                <p>쌀밥 · 국 · 반찬</p>
              </div>
            ))}
          </>
        )}
        {tab === "학생관리" && (
          <>
            <h3>{TEACHER.homeroom}</h3>
            <p>〈 2026년 9월 〉</p>
            <div
              style={{
                background: P.orange,
                color: P.white,
                padding: 12,
                borderRadius: 9,
                marginBottom: 16,
              }}
            >
              QR출력{selected ? " · 2명 선택" : ""}
            </div>
            <p>☐ 번호_이름 식사 체크인</p>
            <p>
              월별 학생 현황은 큰 화면에서
              <br />
              자세히 확인할 수 있습니다.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
export function ClassTable({ selected = false }: { selected?: boolean }) {
  return (
    <div
      style={{
        background: P.white,
        borderRadius: 20,
        padding: 28,
        fontSize: 23,
        border: `1px solid ${P.line}`,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 25,
        }}
      >
        <strong>1학년 2반 〈 2026년 9월 〉</strong>
        <span
          style={{
            padding: "12px 22px",
            background: P.orange,
            color: P.white,
            borderRadius: 12,
          }}
        >
          QR출력{selected ? " (2명)" : ""}
        </span>
      </div>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          textAlign: "center",
        }}
      >
        <thead>
          <tr>
            {[
              "☐ 번호_이름",
              "21일 조식",
              "21일 석식",
              "22일 조식",
              "22일 석식",
            ].map((t) => (
              <th
                key={t}
                style={{ padding: 18, background: P.paper, fontSize: 20 }}
              >
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {["01_김하늘", "02_이도윤", "03_박서연", "04_최지우"].map(
            (name, i) => (
              <tr key={name}>
                <td
                  style={{
                    padding: 14,
                    border: `1px solid ${P.line}`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {selected && i < 2 ? "☑" : "☐"} {name}
                </td>
                {[0, 1, 2, 3].map((j) => (
                  <td
                    key={j}
                    style={{
                      border: `1px solid ${P.line}`,
                      background:
                        i === 1 || (i === 3 && j > 1)
                          ? "#d6d3d1"
                          : j === 0
                            ? P.blueSoft
                            : P.white,
                      color: P.blue,
                    }}
                  >
                    {i !== 1 && j === 0 ? "✓" : ""}
                  </td>
                ))}
              </tr>
            ),
          )}
        </tbody>
      </table>
      <p style={{ color: P.muted, fontSize: 20 }}>
        흰색: 신청 회색: 미신청 색상 + ✓: 체크인 완료
      </p>
    </div>
  );
}
