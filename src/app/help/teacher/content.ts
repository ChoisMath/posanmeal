export const TEACHER_VIDEO_ID = "t1ujLxBVelA";
export const TEACHER_VIDEO_URL = "https://youtu.be/t1ujLxBVelA";

export const chapters = [
  { id: "start", title: "접속 · 앱 설치", steps: [
    { id: "address", startSeconds: 14, title: "1. 접속과 로그인", images: ["Address", "Login"], paragraphs: ["브라우저 주소창에 meal.posan.kr을 입력하고 Google로 로그인합니다. 학교에 등록된 본인 계정을 선택해 주세요.", "다른 계정으로 접속했다면 로그아웃 후 다시 로그인합니다. 계정을 모르거나 접속이 어렵다면 관리자(영양사)에게 문의해 주세요."] },
    { id: "install", startSeconds: 25, title: "2. 홈 화면에 앱 설치", images: ["AndroidInstall", "IphoneInstall"], paragraphs: ["안드로이드: Chrome에서 접속 → 주소 오른쪽 ⋮ → 설치 및 바로가기 만들기 → 설치를 선택합니다. 주소를 확인하고 설치를 완료하세요. 버전에 따라 ‘앱 설치’ 또는 ‘홈 화면에 추가’로 표시될 수 있습니다.", "아이폰: Safari에서 접속 → 공유 → 홈 화면에 추가를 선택합니다. 항목이 없으면 동작 편집에서 추가하세요. 이름과 주소를 확인하고 ‘웹 앱으로 열기’가 보이면 켠 뒤 추가합니다.", "홈 화면의 PosanMeal 아이콘으로 바로 접속할 수 있습니다."] },
  ] },
  { id: "checkin", title: "정산 · 기록 확인", steps: [
    { id: "qr", startSeconds: 143, title: "3. QR에서 정산 구분 선택", images: ["Qr"], paragraphs: ["일반적으로 저녁 8시 20분 이전에 퇴근하실 경우, QR 탭에서 ‘개인정산’을 선택하면 일반정산으로 처리됩니다.", "에이스 수업을 하시거나 저녁 8시 20분 이후까지 근무하실 경우에는 ‘근무’를 선택한 QR을 인식하면 특근매식비로 정산됩니다.", "이는 체크인 시각이 아닌 근무·퇴근 기준입니다. 알맞은 항목을 선택한 뒤 급식실에서 QR 코드를 인식해 주세요."] },
    { id: "history", startSeconds: 174, title: "4. 본인의 체크인 기록 확인", images: ["History"], paragraphs: ["확인 탭에서 월별 달력으로 본인의 QR 체크인 기록을 확인할 수 있습니다.", "누락이나 정산 구분 등 오류가 있으면 날짜와 내용을 확인해 관리자(영양사)에게 말씀해 주세요."] },
  ] },
  { id: "homeroom", title: "담임교사 학급 관리", steps: [
    { id: "students", startSeconds: 190, title: "5. 학생관리와 월별 체크인", images: ["Students"], paragraphs: ["담임교사의 경우 ‘학생관리’와 ‘신청현황’ 탭이 추가로 활성화됩니다.", "학생관리에서 월을 바꾸며 학급 학생들의 월별 식사 체크인 현황을 확인합니다. 날짜·식사별로 신청한 칸은 흰색, 신청하지 않은 칸은 회색 음영입니다.", "체크인을 마친 칸은 식사별 색상과 체크 표시로 구분됩니다."] },
    { id: "print", startSeconds: 216, title: "6. 필요한 학생만 QR 인쇄", images: ["Print"], paragraphs: ["휴대전화 화면 파손 등으로 QR 인식이 어려운 학생에게 인쇄한 코드를 제공할 수 있습니다.", "번호_이름 앞의 체크박스로 인쇄할 학생을 선택하고 ‘QR출력’을 누르세요. 인쇄한 코드는 해당 학생 본인만 사용하도록 안내해 주세요."] },
    { id: "applications", startSeconds: 243, title: "7. 우리 반 신청자와 신청시간", images: ["Applications"], paragraphs: ["신청현황에는 관리자가 생성한 식사 신청 목록이 표시됩니다.", "공고를 클릭하면 우리 반 신청자 목록과 신청시간, 학생별 신청 식사와 내역을 확인할 수 있습니다."] },
  ] },
  { id: "profile", title: "개인정보 · 얼굴 등록", steps: [
    { id: "face", startSeconds: 261, title: "8. 내 정보 확인과 얼굴 체크인", images: ["Profile", "Face"], paragraphs: ["개인정보 탭에서 본인의 이름, 교과, 담임 등 정보를 확인하고 필요하면 얼굴등록을 진행합니다. 얼굴 등록은 선택 사항입니다.", "수집·이용 안내를 읽고 동의한 뒤 카메라를 허용해 화면 안내에 따라 등록하세요.", "급식실 체크인 화면에서 ‘얼굴로 체크인’을 선택한 뒤, 표시된 이름이 본인인지 확인하고 ‘근무’ 또는 ‘개인’을 선택해야 체크인이 완료됩니다.", "얼굴 인식은 베타 기능입니다. 본인이 아니면 취소하고, 인식이 어려우면 QR로 체크인해 주세요."] },
    { id: "help", startSeconds: 306, title: "9. 물음표로 다시 보기", images: ["Closing"], paragraphs: ["교사 화면 위의 ‘?’를 누르면 이 도움말 페이지가 새 탭으로 열립니다.", "영상과 화면별 안내를 언제든 다시 확인할 수 있습니다."] },
  ] },
];
