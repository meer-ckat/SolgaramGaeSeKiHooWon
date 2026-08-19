// 옥도단 후원 — 공개 현황 JSON 엔드포인트 (읽기 전용)
//
// 이 스크립트는 장부 스프레드시트에 "확장 프로그램 > Apps Script"로
// 연결(container-bound)해서 사용합니다. 시트 ID를 코드에 적을 필요가 없습니다.
//
// 시트 이름: ledger
// 열 순서:  date | type | amount | description | public
// type:     donation(후원 입금) / expense(지출)
// public:   TRUE인 expense 행만 웹에 공개됩니다.
//
// 주의: description에 후원자 이름 등 개인정보를 절대 쓰지 마세요.
// public=TRUE 행의 date/description/amount만 외부로 나갑니다.

const GOAL = 300000;        // 목표 금액(원)
const SHEET_NAME = "ledger";

function doGet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const rows = sheet ? sheet.getDataRange().getValues() : [];

  let received = 0;
  let spent = 0;
  const expenses = [];

  // 첫 행은 머리글. 형식이 잘못된 행은 건너뛴다.
  for (let i = 1; i < rows.length; i++) {
    const [date, type, amount, description, isPublic] = rows[i];
    const n = Number(amount);
    if (!date || isNaN(n) || n === 0) continue;

    if (type === "donation") {
      received += Math.abs(n);
    } else if (type === "expense") {
      spent += Math.abs(n);
      if (isPublic === true || String(isPublic).toUpperCase() === "TRUE") {
        expenses.push({
          date: formatDate_(date),
          description: String(description || ""),
          amount: Math.abs(n),
        });
      }
    }
  }

  const body = {
    goal: GOAL,
    received: received,
    spent: spent,
    balance: received - spent,
    updatedAt: Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd'T'HH:mm:ssXXX"),
    expenses: expenses,
  };

  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

function formatDate_(d) {
  if (d instanceof Date) {
    return Utilities.formatDate(d, "Asia/Seoul", "yyyy-MM-dd");
  }
  return String(d);
}
