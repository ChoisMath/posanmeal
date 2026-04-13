/**
 * Posanmeal — 포산고 석식 관리 스프레드시트 템플릿 생성기
 *
 * 사용법:
 *   1. Google Spreadsheet를 새로 만든다
 *   2. 확장 프로그램 > Apps Script 를 연다
 *   3. 이 코드를 code.gs에 붙여넣고 저장한다
 *   4. 스프레드시트로 돌아와서 새로고침하면 "포산밀" 메뉴가 나타난다
 *   5. 포산밀 > 템플릿 생성 을 클릭한다
 *   6. 스프레드시트를 "링크가 있는 모든 사용자" 공개로 설정한다
 *   7. 관리자 페이지에서 각 시트의 URL을 붙여넣어 가져온다
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("포산밀")
    .addItem("템플릿 생성", "createTemplate")
    .addToUi();
}

function createTemplate() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  createStudentSheet_(ss);
  createTeacherSheet_(ss);

  // 기본 Sheet1 제거 (시트가 3개 이상일 때만)
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName() === "Sheet1" || sheets[i].getName() === "시트1") {
      if (sheets.length > 1) {
        ss.deleteSheet(sheets[i]);
      }
      break;
    }
  }

  ss.setActiveSheet(ss.getSheetByName("학생"));
  SpreadsheetApp.getUi().alert(
    "템플릿 생성 완료!\n\n" +
    "- '학생' 시트와 '교사' 시트가 생성되었습니다.\n" +
    "- 예시 데이터를 참고하여 실제 데이터를 입력하세요.\n" +
    "- 스프레드시트를 '링크가 있는 모든 사용자에게 공개'로 설정하세요.\n" +
    "- 관리자 페이지에서 각 시트 URL을 붙여넣으면 됩니다."
  );
}

// ─── 학생 시트 ────────────────────────────────────────────────

function createStudentSheet_(ss) {
  var sheet = ss.getSheetByName("학생");
  if (!sheet) {
    sheet = ss.insertSheet("학생");
  } else {
    sheet.clear();
  }

  var headers = ["email", "grade", "classNum", "number", "name"];
  var headerDescriptions = [
    "이메일 (Google 계정)",
    "학년 (1~3)",
    "반 (숫자)",
    "번호 (숫자)",
    "이름"
  ];

  // 헤더 행
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight("bold");
  headerRange.setBackground("#FEF3C7"); // amber-100
  headerRange.setFontColor("#92400E");  // amber-800
  headerRange.setBorder(false, false, true, false, false, false, "#D97706", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  // 헤더 설명 (노트)
  for (var i = 0; i < headerDescriptions.length; i++) {
    sheet.getRange(1, i + 1).setNote(headerDescriptions[i]);
  }

  // 예시 데이터
  var sampleData = [
    ["hong@school.edu", 1, 1, 1, "홍길동"],
    ["kim@school.edu", 1, 1, 2, "김철수"],
    ["lee@school.edu", 2, 3, 15, "이영희"],
    ["park@school.edu", 3, 2, 8, "박민수"]
  ];
  sheet.getRange(2, 1, sampleData.length, headers.length).setValues(sampleData);

  // 예시 행 스타일 (연한 회색, 삭제해야 할 데이터임을 표시)
  var sampleRange = sheet.getRange(2, 1, sampleData.length, headers.length);
  sampleRange.setFontColor("#9CA3AF"); // gray-400
  sampleRange.setFontStyle("italic");

  // 열 너비 설정
  sheet.setColumnWidth(1, 220); // email
  sheet.setColumnWidth(2, 60);  // grade
  sheet.setColumnWidth(3, 70);  // classNum
  sheet.setColumnWidth(4, 60);  // number
  sheet.setColumnWidth(5, 100); // name

  // 데이터 유효성 검사
  var maxRows = 500;

  // grade: 1, 2, 3
  var gradeRule = SpreadsheetApp.newDataValidation()
    .requireNumberBetween(1, 3)
    .setHelpText("학년은 1~3 사이 숫자를 입력하세요")
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, 2, maxRows, 1).setDataValidation(gradeRule);

  // classNum: 1~20
  var classRule = SpreadsheetApp.newDataValidation()
    .requireNumberBetween(1, 20)
    .setHelpText("반은 1~20 사이 숫자를 입력하세요")
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, 3, maxRows, 1).setDataValidation(classRule);

  // number: 1~50
  var numberRule = SpreadsheetApp.newDataValidation()
    .requireNumberBetween(1, 50)
    .setHelpText("번호는 1~50 사이 숫자를 입력하세요")
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, 4, maxRows, 1).setDataValidation(numberRule);

  // 숫자 열 서식 (소수점 없이)
  sheet.getRange(2, 2, maxRows, 1).setNumberFormat("0");
  sheet.getRange(2, 3, maxRows, 1).setNumberFormat("0");
  sheet.getRange(2, 4, maxRows, 1).setNumberFormat("0");

  // 첫 행 고정
  sheet.setFrozenRows(1);

  return sheet;
}

// ─── 교사 시트 ────────────────────────────────────────────────

function createTeacherSheet_(ss) {
  var sheet = ss.getSheetByName("교사");
  if (!sheet) {
    sheet = ss.insertSheet("교사");
  } else {
    sheet.clear();
  }

  var headers = ["email", "subject", "homeroom", "position", "name"];
  var headerDescriptions = [
    "이메일 (Google 계정)",
    "교과명 (예: 수학, 영어)",
    "담임 학급 (예: 2-6) — 비담임은 비워두기",
    "직책 (예: 교사, 부장)",
    "이름"
  ];

  // 헤더 행
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight("bold");
  headerRange.setBackground("#FEF3C7");
  headerRange.setFontColor("#92400E");
  headerRange.setBorder(false, false, true, false, false, false, "#D97706", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  // 헤더 설명 (노트)
  for (var i = 0; i < headerDescriptions.length; i++) {
    sheet.getRange(1, i + 1).setNote(headerDescriptions[i]);
  }

  // 예시 데이터
  var sampleData = [
    ["choi@school.edu", "수학", "1-3", "교사", "최수학"],
    ["jung@school.edu", "영어", "2-6", "부장", "정영어"],
    ["kang@school.edu", "체육", "", "교사", "강체육"]
  ];
  sheet.getRange(2, 1, sampleData.length, headers.length).setValues(sampleData);

  // 예시 행 스타일
  var sampleRange = sheet.getRange(2, 1, sampleData.length, headers.length);
  sampleRange.setFontColor("#9CA3AF");
  sampleRange.setFontStyle("italic");

  // 열 너비 설정
  sheet.setColumnWidth(1, 220); // email
  sheet.setColumnWidth(2, 100); // subject
  sheet.setColumnWidth(3, 100); // homeroom
  sheet.setColumnWidth(4, 100); // position
  sheet.setColumnWidth(5, 100); // name

  // homeroom 유효성 검사 (학년-반 목록)
  var homeroomValues = [];
  for (var g = 1; g <= 3; g++) {
    for (var c = 1; c <= 20; c++) {
      homeroomValues.push(g + "-" + c);
    }
  }
  var homeroomRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(homeroomValues, true)
    .setHelpText("담임 학급을 선택하세요 (예: 2-6). 비담임은 비워두세요.")
    .setAllowInvalid(true) // 비담임은 비워둘 수 있음
    .build();
  sheet.getRange(2, 3, 500, 1).setDataValidation(homeroomRule);

  // 첫 행 고정
  sheet.setFrozenRows(1);

  return sheet;
}
