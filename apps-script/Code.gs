// 옥도단 후원 — 공개 현황 JSON 엔드포인트 (읽기 전용)
//
// 실제로 돌아가는 것은 script.google.com 의 "옥도단 후원 API" 프로젝트입니다.
// 이 파일은 그 배포본을 그대로 옮겨 적은 사본(백업)입니다.
//
// 시트 이름: ledger
// 열 순서:  A 날짜 | B 구분 | C 금액 | D 내용 | E 공개 | F 표시명
// 구분:     donation(후원 입금) / expense(지출)
// 목표 금액: ledger 시트의 G2 셀
//
// 주의: D열(내용)에 후원자 이름 등 개인정보를 절대 쓰지 마세요.

const SHEET_ID = "1e5964jmcb_ZCQ4QlAgLr1oo56ARnlHGrn5amkAp1nP0";
const SHEET_NAME = "ledger";
const TIMEZONE = "Asia/Seoul";

function doGet() {
  const sheet = SpreadsheetApp
    .openById(SHEET_ID)
    .getSheetByName(SHEET_NAME);

  const rows = sheet ? sheet.getDataRange().getValues() : [];

  // 목표 금액 — ledger!G2 에서 읽음
  let goal = 0;

  if (sheet) {
    const goalValue = sheet.getRange("G2").getValue();
    goal = Number(goalValue) || 0;
  }

  // 이번 주 범위 — 월요일 00:00 ~ 다음 주 월요일 00:00
  const now = new Date();
  const weekStart = getWeekStart_(now);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  let received = 0;
  let spent = 0;

  // 전체 공개 지출 내역
  const expenses = [];

  // 데이터 처리
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    const date = parseDate_(row[0]);
    const type = String(row[1] || "").trim().toLowerCase();
    const amount = Number(row[2]);

    if (!date || !Number.isFinite(amount) || amount === 0) {
      continue;
    }

    const value = Math.abs(amount);

    // 이번 주 통계
    const isThisWeek = date >= weekStart && date < weekEnd;

    if (isThisWeek) {
      if (type === "donation") {
        received += value;
      }
      else if (type === "expense") {
        spent += value;
      }
    }

    // 전체 공개 지출 내역
    if (type === "expense") {
      const isPublic =
        row[4] === true ||
        String(row[4]).trim().toUpperCase() === "TRUE";

      if (isPublic) {
        expenses.push({
          date: formatDate_(date),
          description: String(row[3] || ""),
          amount: value
        });
      }
    }
  }

  // 최신 지출부터
  expenses.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  // JSON 응답
  const body = {
    goal: goal,

    // 이번 주 통계
    received: received,
    spent: spent,
    balance: received - spent,

    // 이번 주 범위
    weekStart: formatDate_(weekStart),
    weekEnd: formatDate_(new Date(weekEnd.getTime() - 1)),

    // 전체 공개 지출
    expenses: expenses,

    // 아래 둘은 Admin.gs 에 있습니다
    donations: getDonations_(),
    photos: getPhotos_(),

    updatedAt: Utilities.formatDate(
      now,
      TIMEZONE,
      "yyyy-MM-dd'T'HH:mm:ssXXX"
    )
  };

  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

// 이번 주 월요일 00:00
function getWeekStart_(date) {
  const d = new Date(date);

  d.setHours(12, 0, 0, 0);

  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;

  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);

  return d;
}

// 날짜 파싱
function parseDate_(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date && !isNaN(value.getTime())) {
    return value;
  }

  const text = String(value).trim();

  if (!text) {
    return null;
  }

  const parsed = new Date(text);

  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);

    const result = new Date(year, month, day);

    if (!isNaN(result.getTime())) {
      return result;
    }
  }

  return null;
}

// 날짜 표시
function formatDate_(date) {
  return Utilities.formatDate(date, TIMEZONE, "yyyy-MM-dd");
}
