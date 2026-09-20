import React from "react";
import { useCurrentFrame } from "remotion";
import {
  Stage,
  Headline,
  Phone,
  Reveal,
  InfoCard,
  currentLine,
  ActionCue,
} from "./SceneLayout";
import { TeacherMock, ClassTable, TEACHER } from "./TeacherMockups";
import { MockQr } from "../student/StudentMockups";
import { PALETTE as P } from "../student/style";
import { NARRATION, type TeacherSceneId } from "./narration";
import { sceneFrames, lineAt } from "./timing";
import { Address } from "./scenes/Address";
import { AndroidInstall } from "./scenes/AndroidInstall";
import { IphoneInstall } from "./scenes/IphoneInstall";
import type { SceneDef } from "../scenes";

const content: Record<
  string,
  { title: string; subtitle: string; tab: string; cards: string[] }
> = {
  Intro: {
    title: "선생님의 식사 기록,\n학급 확인까지.",
    subtitle: "교사 · 담임교사 사용 안내",
    tab: "식단",
    cards: [
      "접속과 앱 설치",
      "개인정산 · 근무 선택",
      "담임교사의 학생관리와 신청현황",
    ],
  },
  Login: {
    title: "학교에 등록된\n내 계정으로 로그인",
    subtitle: "접속이 어려우면 관리자(영양사)에게 문의하세요.",
    tab: "로그인",
    cards: [
      "Google로 로그인 → 등록 계정 선택",
      "다른 계정이라면 로그아웃 후 다시 로그인",
      "계정 확인 · 접속 문의: 관리자(영양사)",
    ],
  },
  Tabs: {
    title: "교사 공통 메뉴와\n담임 전용 메뉴",
    subtitle: "담임교사는 두 개의 탭을 더 사용할 수 있습니다.",
    tab: "식단",
    cards: [
      "교사: 식단 · QR · 확인 · 개인정보",
      "담임교사: 학생관리 · 신청현황 추가",
    ],
  },
  Qr: {
    title: "QR을 보여주기 전,\n정산 구분을 선택하세요.",
    subtitle: "시간은 체크인 시간이 아닌 근무·퇴근 기준입니다.",
    tab: "QR",
    cards: [
      "개인정산 → 일반정산",
      "일반적으로 저녁 8시 20분 이전 퇴근",
      "근무 → 특근매식비 정산",
      "에이스 수업 또는 저녁 8시 20분 이후까지 근무",
    ],
  },
  History: {
    title: "확인 탭에서\n내 체크인 기록 확인",
    subtitle: "월을 바꾸며 식사 날짜와 정산 구분을 살펴보세요.",
    tab: "확인",
    cards: [
      "본인의 QR 체크인 기록 확인",
      "누락 · 오류 → 관리자(영양사)에게 문의",
      "문의할 때는 날짜와 오류 내용을 함께 전달",
    ],
  },
  Applications: {
    title: "공고를 누르면,\n우리 반 신청자 목록",
    subtitle: "관리자가 생성한 식사 신청 목록을 확인합니다.",
    tab: "신청현황",
    cards: [
      "신청현황 → 식사 신청 공고 선택",
      "우리 반 신청자와 신청시간 확인",
      "학생별 신청 식사와 내역 확인",
    ],
  },
  Profile: {
    title: "내 정보 확인과\n선택적 얼굴 등록",
    subtitle: "개인정보 탭에서 시작합니다.",
    tab: "개인정보",
    cards: [
      "이름 · 교과 · 담임 등 본인 정보 확인",
      "얼굴등록은 필요할 때 선택",
      "수집·이용 동의 → 카메라 허용 → 등록",
    ],
  },
  Closing: {
    title: "다시 궁금할 땐,\n물음표를 눌러 주세요.",
    subtitle: "교사 사용 안내 · meal.posan.kr/help/teacher",
    tab: "QR",
    cards: [
      "화면 위 ? → 교사 도움말 페이지",
      "이 영상과 화면별 안내를 다시 확인",
      "정산 구분과 체크인 기록을 확인해 주세요.",
    ],
  },
};
function TeacherScene({ id }: { id: TeacherSceneId }) {
  const frame = useCurrentFrame();
  const line = currentLine(id, frame);
  if (id === "Students" || id === "Print")
    return (
      <Stage id={id} chapter="담임교사 · 학생관리">
        <Headline
          size={66}
          width={1650}
          subtitle={
            id === "Students"
              ? "날짜·식사별 칸을 확인하세요. 신청은 흰색, 미신청은 회색입니다."
              : "휴대전화 화면 파손 등으로 QR 인식이 어려운 학생에게 인쇄해 주세요."
          }
        >
          {id === "Students"
            ? "우리 반의 월별 식사 체크인 현황"
            : "체크박스로 학생 선택 → QR출력"}
        </Headline>
        <Reveal
          delay={12}
          style={{
            position: "absolute",
            left: 124,
            top: 400,
            width: id === "Print" && line >= 2 ? 1160 : 1650,
          }}
        >
          <ClassTable selected={id === "Print" && line >= 1} />
        </Reveal>
        {id === "Print" && line >= 2 && (
          <Reveal
            delay={lineAt(id, 2, 0)}
            style={{
              position: "absolute",
              left: 1350,
              top: 430,
              background: P.white,
              padding: 30,
              borderRadius: 14,
            }}
          >
            <MockQr size={230} />
            <p style={{ fontSize: 22, textAlign: "center" }}>
              1학년 2반 01_김하늘
            </p>
            <p style={{ fontSize: 18, color: P.muted }}>본인만 사용하세요</p>
          </Reveal>
        )}
        <ActionCue
          x={id === "Print" && line >= 2 ? 1180 : 165}
          y={id === "Print" && line >= 2 ? 445 : 570}
          at={lineAt(id, Math.min(line, 2), 0.35)}
        />
      </Stage>
    );
  if (id === "Face")
    return (
      <Stage id={id} chapter="얼굴로 체크인 · 베타">
        <Headline
          size={64}
          width={1650}
          subtitle="표시된 이름이 본인인지 확인한 뒤 정산 구분을 선택합니다."
        >
          얼굴로 체크인 → 본인 확인 → 근무 / 개인
        </Headline>
        <Reveal
          delay={10}
          style={{
            position: "absolute",
            left: 220,
            top: 420,
            width: 1450,
            background: P.navy,
            borderRadius: 24,
            padding: 40,
            display: "flex",
            gap: 45,
            alignItems: "center",
          }}
        >
          <div
            style={{
              width: 380,
              height: 280,
              border: `4px solid ${P.green}`,
              borderRadius: 24,
              color: P.white,
              display: "grid",
              placeItems: "center",
              fontSize: 34,
            }}
          >
            카메라 · 얼굴 인식
          </div>
          <div
            style={{
              background: P.white,
              padding: 35,
              borderRadius: 20,
              flex: 1,
              fontSize: 30,
            }}
          >
            <strong>{TEACHER.name} 선생님이 맞으신가요?</strong>
            <p style={{ color: P.muted, fontSize: 23 }}>
              본인 확인 후 정산 구분을 선택하세요.
            </p>
            <div style={{ display: "flex", gap: 15 }}>
              {["근무", "개인", "취소"].map((t) => (
                <span
                  key={t}
                  style={{
                    padding: "18px 38px",
                    background: t === "근무" ? P.blue : P.paper,
                    color: t === "근무" ? P.white : P.ink,
                    borderRadius: 12,
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
            <p style={{ fontSize: 21, color: P.red }}>
              본인이 아니면 취소 · 인식이 어려우면 QR
            </p>
          </div>
        </Reveal>
      </Stage>
    );
  const c = content[id];
  return (
    <Stage id={id} chapter={c.subtitle}>
      <Headline size={68} width={1100} subtitle={c.subtitle}>
        {c.title.split("\n").map((t, i) => (
          <React.Fragment key={t}>
            {i > 0 && <br />}
            {t}
          </React.Fragment>
        ))}
      </Headline>
      <div
        style={{
          position: "absolute",
          left: 124,
          top: 485,
          width: 1100,
          display: "grid",
          gap: 15,
        }}
      >
        {c.cards.map((text, i) => (
          <Reveal key={text} delay={12 + i * 5}>
            <InfoCard
              title={text}
              active={id === "Qr" ? (line < 2 ? i < 2 : i >= 2) : true}
              number={String(i + 1).padStart(2, "0")}
              style={{ padding: "20px 23px" }}
            />
          </Reveal>
        ))}
      </div>
      <Phone>
        <TeacherMock
          tab={c.tab}
          work={id === "Qr" && line >= 2}
          detail={id === "Applications" && line >= 1}
        />
      </Phone>
      {id === "Closing" && (
        <ActionCue x={1696} y={179} at={lineAt(id, 0, 0.5)} />
      )}
    </Stage>
  );
}
const special: Partial<Record<TeacherSceneId, React.FC>> = {
  Address,
  AndroidInstall,
  IphoneInstall,
};
export const TEACHER_SCENES: SceneDef[] = NARRATION.map(({ id }) => ({
  id,
  component: special[id] ?? (() => <TeacherScene id={id} />),
  durationInFrames: sceneFrames(id),
}));
