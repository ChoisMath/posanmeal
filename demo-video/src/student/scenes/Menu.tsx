import React from "react";
import { Stage, Headline, Phone, Reveal, InfoCard } from "../SceneLayout";
import { StudentAppMock } from "../StudentMockups";

export const Menu: React.FC = () => <Stage id="Menu" chapter="식단 · 날짜별 메뉴 확인">
  <Headline subtitle="조식·중식·석식 메뉴를 날짜별로 볼 수 있어요.">오늘 무엇을 먹는지,<br />미리 확인하세요.</Headline>
  <Reveal delay={20} style={{ position: "absolute", left: 124, top: 495, width: 1010, display: "grid", gap: 22 }}>
    <InfoCard number="01" title="날짜 화살표 또는 좌우 스와이프" text="전날·다음 날의 식단도 확인할 수 있어요." />
    <InfoCard number="02" title="메뉴와 알레르기 정보 함께 보기" text="나에게 필요한 식품 정보를 꼭 살펴보세요." />
  </Reveal>
  <Phone><StudentAppMock tab="meal" /></Phone>
</Stage>;
