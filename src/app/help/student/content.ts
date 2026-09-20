export const STUDENT_VIDEO_ID = "rOww_TPHGR0";
export const STUDENT_VIDEO_URL = "https://youtu.be/rOww_TPHGR0";

export type GuideImage = {
  file: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
};

export type GuideStep = {
  id: string;
  title: string;
  startSeconds: number;
  paragraphs: string[];
  notice?: { title: string; body: string; tone: "warning" | "info" };
  images: GuideImage[];
};

export type GuideChapter = {
  id: string;
  title: string;
  description: string;
  steps: GuideStep[];
};

export const guideChapters: GuideChapter[] = [
  {
    id: "start",
    title: "접속과 로그인",
    description: "홈 화면에 포산밀을 추가하고 등록된 내 계정으로 시작해요.",
    steps: [
      {
        id: "address",
        title: "meal.posan.kr로 접속하기",
        startSeconds: 11,
        paragraphs: [
          "휴대전화나 컴퓨터에서 인터넷 브라우저를 열고 주소창에 meal.posan.kr을 입력하세요.",
          "자주 이용한다면 아래 방법으로 홈 화면에 포산밀 아이콘을 추가해 두면 편리해요.",
        ],
        images: [
          { file: "01-address.webp", alt: "주소창에 meal.posan.kr을 입력하는 안내 화면", caption: "브라우저 주소창에 meal.posan.kr 입력", width: 1280, height: 544 },
        ],
      },
      {
        id: "install",
        title: "휴대전화 홈 화면에 추가하기",
        startSeconds: 22,
        paragraphs: [
          "Android: Chrome에서 meal.posan.kr에 접속한 뒤 주소 오른쪽 ⋮ 메뉴 → 설치 및 바로가기 만들기 → 설치를 선택하세요(버전에 따라 ‘앱 설치’ 또는 ‘홈 화면에 추가’로 표시될 수 있어요).",
          "설치 창에서 주소를 확인하고 설치를 누른 뒤 완료될 때까지 기다리면, 홈 화면이나 앱 목록의 PosanMeal 아이콘으로 접속할 수 있어요.",
          "iPhone: Safari에서 meal.posan.kr에 접속해 공유 버튼(보이지 않으면 더 보기 → 공유)을 누르고, 공유 메뉴를 위로 올려 ‘홈 화면에 추가’를 선택하세요(항목이 없다면 맨 아래 ‘동작 편집’에서 추가하세요).",
          "이름과 주소를 확인하고 ‘웹 앱으로 열기’가 보이면 켠 뒤 오른쪽 위 ‘추가’를 누르면, 홈 화면의 PosanMeal 아이콘으로 열 수 있어요.",
        ],
        images: [
          { file: "01a-android-menu.webp", alt: "Android Chrome의 점 세 개 메뉴에서 설치 항목을 선택하는 화면", caption: "Android · Chrome 메뉴에서 설치", width: 1280, height: 515 },
          { file: "01c-iphone-share.webp", alt: "iPhone Safari 공유 메뉴의 홈 화면에 추가 항목", caption: "iPhone · 공유 → 홈 화면에 추가", width: 640, height: 1342 },
          { file: "01d-iphone-add.webp", alt: "iPhone에서 이름과 주소를 확인하고 홈 화면에 추가하는 화면", caption: "이름과 주소 확인 후 추가", width: 640, height: 1342 },
        ],
      },
      {
        id: "login",
        title: "학교에 등록된 Google 계정으로 로그인하기",
        startSeconds: 109,
        paragraphs: [
          "‘Google로 로그인’을 누르고 학교에 등록된 본인 계정을 선택하세요.",
          "다른 계정으로 로그인했다면 오른쪽 위에서 로그아웃한 뒤 다시 로그인해 등록된 계정을 고르거나 ‘다른 계정 사용’을 누르세요.",
          "같은 계정이 계속 자동 선택되면 새 시크릿 창에서 meal.posan.kr에 접속해 보세요.",
          "평소 쓰는 계정이라도 학교에 등록되지 않았다면 이용할 수 없으니, 등록된 계정을 모르거나 계속 접속이 안 되면 담임 선생님께 확인하세요.",
        ],
        images: [
          { file: "02-login.webp", alt: "Google 로그인에서 학교에 등록된 본인 계정을 선택하는 화면", caption: "학교에 등록된 내 계정 선택", width: 640, height: 1342 },
          { file: "03-recovery.webp", alt: "잘못 로그인했을 때 로그아웃과 계정 다시 선택을 안내하는 화면", caption: "다른 계정이면 로그아웃 후 다시 선택", width: 1280, height: 544 },
        ],
      },
    ],
  },
  {
    id: "meals",
    title: "식단과 급식 신청",
    description: "식단을 살펴보고 신청 기간 안에 식사와 날짜를 확인해요.",
    steps: [
      {
        id: "menu",
        title: "탭과 오늘의 식단 살펴보기",
        startSeconds: 146,
        paragraphs: [
          "로그인하면 식단·QR·개인정보·확인 탭을 사용할 수 있고, 급식 신청 공고가 있을 때는 신청 탭이 추가로 나타나요.",
          "식단 탭에서 날짜를 바꾸며 조식·중식·석식 메뉴와 필요한 알레르기 정보를 함께 확인하세요.",
        ],
        images: [
          { file: "04-menu.webp", alt: "학생 식단 탭의 날짜 선택과 조식·중식·석식 메뉴", caption: "날짜별 메뉴와 알레르기 정보 확인", width: 640, height: 1342 },
        ],
      },
      {
        id: "apply",
        title: "공고 확인부터 신청·수정·취소까지",
        startSeconds: 170,
        paragraphs: [
          "신청 탭에서 공고의 ‘신청하기’를 누르고 신청 기간과 본인 정보를 확인하세요.",
          "공고에 따라 ‘신청함’을 고르거나 식사할 요일·날짜를 선택하고, ‘면제 대상입니다’ 항목은 실제 대상인 경우에만 체크하세요.",
          "선택한 식사와 급식비를 확인하고 직접 서명한 뒤 ‘신청하기’를 눌러, 목록의 ‘신청완료’ 표시와 ‘신청내역’에서 결과를 확인하세요.",
          "변경할 내용이 있으면 신청 기간 안에 ‘수정/취소’를 열어 다시 서명하고 신청을 수정하거나 취소할 수 있으니, 기간이 끝나기 전에 식사와 날짜를 다시 확인하세요.",
        ],
        images: [
          { file: "05-apply.webp", alt: "급식 신청 공고에서 신청할 식사를 선택하는 화면", caption: "공고와 기간을 확인하고 식사 선택", width: 640, height: 1342 },
          { file: "06-sign.webp", alt: "선택한 급식의 비용을 확인하고 직접 서명하는 화면", caption: "급식비 확인 → 직접 서명 → 신청", width: 640, height: 1342 },
          { file: "07-manage.webp", alt: "신청 기간 안에 급식 신청을 수정하거나 취소하는 화면", caption: "수정과 취소는 신청 기간 안에", width: 640, height: 1342 },
        ],
      },
    ],
  },
  {
    id: "checkin",
    title: "QR과 얼굴 체크인",
    description: "내 QR은 나만 사용하고, 얼굴 체크인은 본인 확인 후 완료해요.",
    steps: [
      {
        id: "qr",
        title: "내 QR로 체크인하기",
        startSeconds: 224,
        paragraphs: [
          "오늘 신청된 식사가 있다면 QR 탭에서 본인의 코드를 열어 급식실 체크인 화면에 보여 주세요.",
          "온라인 QR은 일정 시간마다 자동으로 바뀌며, 학교가 인터넷 연결이 어려운 환경에 맞춰 운영할 때는 고정 QR을 사용해요.",
          "휴대전화가 없거나 화면의 QR을 인식하기 어렵다면 담임 선생님께 QR 인쇄를 요청하세요.",
          "인쇄한 QR도 본인만 사용하고, 잃어버렸다면 바로 담임 선생님께 알려 주세요.",
        ],
        notice: { title: "내 QR은 내 식사 확인증이에요", body: "QR을 캡처하거나 다른 사람에게 공유하지 마세요. 특히 고정 QR과 인쇄물은 다른 사람이 쓰지 않도록 보관해 주세요.", tone: "warning" },
        images: [
          { file: "08-qr.webp", alt: "학생 QR 탭에서 본인 식사 체크인 코드를 보여 주는 화면", caption: "급식실에서 QR 화면 보여 주기", width: 640, height: 1342 },
          { file: "09-print.webp", alt: "휴대전화 대신 사용할 인쇄 QR 카드를 담임에게 요청하는 안내", caption: "QR 인쇄가 필요하면 담임 선생님께", width: 1280, height: 544 },
        ],
      },
      {
        id: "face-enrollment",
        title: "원한다면 얼굴 등록하기",
        startSeconds: 263,
        paragraphs: [
          "휴대전화와 인쇄 QR을 모두 가지고 다니기 어렵다면, 베타 버전인 얼굴 인식 기능을 선택해 사용할 수 있어요.",
          "개인정보 탭에서 학년·반·번호·이름을 확인하고, 개인정보 수집·이용 안내를 읽은 뒤 동의하는 경우에만 얼굴 등록을 진행하세요.",
          "카메라를 허용하고 얼굴을 정면으로 맞춘 뒤 화면 안내에 따라 등록하세요.",
          "얼굴 등록은 선택이며 동의하지 않아도 QR로 체크인할 수 있고, 등록한 얼굴 정보는 삭제할 수 있어요.",
        ],
        images: [
          { file: "09b-face-option.webp", alt: "휴대전화와 인쇄 QR을 휴대하기 어려울 때 선택할 수 있는 얼굴 인식 베타 안내", caption: "얼굴 인식 베타는 선택 기능", width: 1280, height: 515 },
          { file: "10-consent.webp", alt: "개인정보 탭의 얼굴 등록과 개인정보 수집·이용 동의 안내", caption: "안내를 읽고 동의한 경우에만 등록", width: 640, height: 1342 },
        ],
      },
      {
        id: "face-checkin",
        title: "얼굴 체크인은 내 이름 확인 후 완료하기",
        startSeconds: 308,
        paragraphs: [
          "급식실 체크인 화면은 기본적으로 QR을 인식하는 화면으로 시작해요.",
          "얼굴을 등록했다면 오른쪽 아래 ‘얼굴로 체크인’을 눌러 전환하세요.",
          "표시된 학번과 이름이 본인인지 꼭 확인한 뒤 ‘확인’을 눌러야 체크인이 완료돼요.",
          "본인이 아니면 ‘취소’를 누르고, 인식이 어려우면 QR로 체크인하세요.",
        ],
        notice: { title: "얼굴 체크인은 베타 기능이에요", body: "다른 사람으로 인식하거나 인식에 실패할 수 있으니, 표시된 학번과 이름을 꼭 확인하세요.", tone: "warning" },
        images: [
          { file: "11-confirm.webp", alt: "급식실 얼굴 체크인에서 표시된 학번과 이름을 확인하고 확인 또는 취소하는 화면", caption: "내 학번·이름이면 확인, 본인이 아니면 취소", width: 1280, height: 730 },
        ],
      },
    ],
  },
  {
    id: "history",
    title: "식사 기록 확인",
    description: "식사 뒤에는 기록을 살피고 낯선 기록이나 누락을 알려요.",
    steps: [
      {
        id: "meal-history",
        title: "내 식사 기록과 도용·누락 확인하기",
        startSeconds: 339,
        paragraphs: [
          "확인 탭의 월별 달력에서 본인의 식사 체크인 기록을 살펴보세요.",
          "실제로 식사한 날과 기록이 맞는지, 내가 먹지 않은 식사가 기록되어 있지는 않은지 확인하세요.",
          "낯선 기록이나 누락을 발견하면 날짜와 식사를 확인해 담임 선생님께 알려 주세요.",
        ],
        images: [
          { file: "12-history.webp", alt: "학생 확인 탭에서 월별 달력으로 식사 체크인 기록을 살펴보는 화면", caption: "먹지 않은 기록이나 누락이 없는지 확인", width: 640, height: 1342 },
        ],
      },
    ],
  },
];
