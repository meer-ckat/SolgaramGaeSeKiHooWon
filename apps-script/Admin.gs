// 옥도단 후원 — 관리자 기능 (doPost) + 공개 데이터 추가분
//
// Code.gs와 같은 프로젝트의 별도 파일입니다. 전역 스코프를 공유하므로
// Code.gs의 SHEET_ID / TIMEZONE / formatDate_ 를 그대로 씁니다.
//
// 처음 한 번 편집기에서 setupOkdodan() 을 실행하세요.
// photos / security_log 시트와 사진 저장용 드라이브 폴더가 만들어집니다.
//
// 토큰은 코드에 두지 않습니다.
// 프로젝트 설정 → 스크립트 속성에 ADMIN_TOKEN 으로 저장하세요.

const PHOTO_SHEET = "photos";
const PHOTO_TRASH = "photos_삭제";
const LOG_SHEET = "security_log";

// 토큰 허용 형식: 영숫자와 - _ 만, 32~64자.
// 따옴표·등호·세미콜론·꺾쇠는 이 검사를 통과할 수 없습니다.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

// 형식을 벗어난 입력 가운데 "명백한 공격 시도"를 가려내는 패턴입니다.
// 정상 관리자는 토큰 칸에 이런 문자를 넣지 않습니다.
const ATTACK_PATTERN = /('|"|;|--|\/\*|<|>|=|\bOR\b|\bAND\b|\bUNION\b|\bSELECT\b|\bDROP\b|\bINSERT\b|\bDELETE\b)/i;

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

const FAIL_LIMIT = 5;         // 실패 허용 횟수
const FAIL_WINDOW_SEC = 600;  // 10분 안에
const LOCK_MINUTES = 15;      // 넘으면 잠그는 시간

// ============================================================
// 진입점
// ============================================================

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const action = String(req.action || "");

    const remaining = lockRemaining_();
    if (remaining > 0) {
      return json_({ ok: false, error: "locked", retryAfter: remaining });
    }

    const given = String(req.token || "");

    // 1단계: 형식 검사(허용 목록). 인젝션 문자는 여기서 전부 걸립니다.
    if (!TOKEN_PATTERN.test(given)) {
      if (ATTACK_PATTERN.test(given)) {
        logSecurity_("공격 시도 패턴", given);
        lockFor_(LOCK_MINUTES);
        return json_({ ok: false, error: "blocked" });
      }
      logSecurity_("형식 오류", given);
      countFailure_();
      return json_({ ok: false, error: "bad_token" });
    }

    // 2단계: 실제 토큰과 대조
    if (!sameToken_(given, prop_("ADMIN_TOKEN"))) {
      logSecurity_("토큰 불일치", "");
      countFailure_();
      return json_({ ok: false, error: "bad_token" });
    }

    clearFailures_();

    if (action === "login") return json_({ ok: true });
    if (action === "addEntry") return addEntry_(req);
    if (action === "uploadPhoto") return uploadPhoto_(req);
    if (action === "deletePhoto") return deletePhoto_(req);

    return json_({ ok: false, error: "unknown_action" });
  } catch (err) {
    return json_({ ok: false, error: "bad_request" });
  }
}

// ============================================================
// 관리자 동작
// ============================================================

function addEntry_(req) {
  const type = req.type === "expense" ? "expense" : "donation";
  const amount = Math.abs(Number(req.amount) || 0);
  if (!amount) return json_({ ok: false, error: "bad_amount" });

  const date = String(req.date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json_({ ok: false, error: "bad_date" });

  writeRow_(sheetByName_(SHEET_NAME), [
    date,
    type,
    type === "expense" ? -amount : amount,
    safeCell_(String(req.description || "").slice(0, 100)),
    req.isPublic === true,
    safeCell_(String(req.name || "").slice(0, 20)),
  ]);

  return json_({ ok: true });
}

// 시트 오른쪽에 안내문이 있으면 appendRow가 그 아래로 밀려납니다.
// A열 기준으로 첫 빈 줄을 찾아 그 자리에 씁니다.
function writeRow_(sheet, values) {
  const colA = sheet.getRange("A1:A").getValues();
  let row = colA.length + 1;

  for (let i = 1; i < colA.length; i++) {
    if (String(colA[i][0]).trim() === "") {
      row = i + 1;
      break;
    }
  }

  sheet.getRange(row, 1, 1, values.length).setValues([values]);
}

function uploadPhoto_(req) {
  const mime = String(req.mimeType || "");
  if (ALLOWED_MIME.indexOf(mime) < 0) return json_({ ok: false, error: "bad_type" });

  const bytes = Utilities.base64Decode(String(req.dataBase64 || ""));
  if (!bytes.length) return json_({ ok: false, error: "bad_request" });
  if (bytes.length > MAX_PHOTO_BYTES) return json_({ ok: false, error: "too_large" });

  const id = String(Date.now());
  const folder = DriveApp.getFolderById(prop_("PHOTO_FOLDER_ID"));
  const file = folder.createFile(Utilities.newBlob(bytes, mime, "okdodan_" + id + ".jpg"));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  sheetByName_(PHOTO_SHEET).appendRow([
    id,
    file.getId(),
    safeCell_(String(req.caption || "").slice(0, 60)),
    formatDate_(new Date()),
    true,
  ]);

  return json_({ ok: true, id: id });
}

// 사진을 photos_삭제 시트로 옮기고 원본에서 지웁니다.
// 드라이브 파일은 휴지통으로 보내므로 30일 안에는 되살릴 수 있습니다.
function deletePhoto_(req) {
  const id = String(req.id || "");
  const sheet = sheetByName_(PHOTO_SHEET);
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== id) continue;

    try {
      DriveApp.getFileById(String(rows[i][1])).setTrashed(true);
    } catch (err) {
      // 파일이 이미 없어도 시트 정리는 진행합니다.
    }

    moveToTrash_(sheet, PHOTO_TRASH, i + 1, rows[i]);
    return json_({ ok: true });
  }

  return json_({ ok: false, error: "not_found" });
}

// 후원 내역: 날짜·표시명·금액만 내보냅니다.
// 시트의 '내용'(D열)은 후원자 정보가 적혀 있을 수 있어 절대 내보내지 않습니다.
function getDonations_() {
  const sheet = sheetByName_(SHEET_NAME);
  const rows = sheet.getDataRange().getValues();
  const out = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (String(row[1] || "").trim().toLowerCase() !== "donation") continue;

    const isPublic = row[4] === true || String(row[4]).trim().toUpperCase() === "TRUE";
    if (!isPublic) continue;

    const date = parseDate_(row[0]);
    const amount = Number(row[2]);
    if (!date || !Number.isFinite(amount) || amount === 0) continue;

    out.push({
      date: formatDate_(date),
      name: String(row[5] || "").trim() || "익명",
      amount: Math.abs(amount),
    });
  }

  return out;
}

// 올해 들어온 후원금 총액입니다.
// 기부금품법은 1천만 원 이상 모집 시 등록을 요구하므로,
// 그 절반인 500만 원에서 사이트가 스스로 모금을 멈춥니다.
function getYearReceived_() {
  const sheet = sheetByName_(SHEET_NAME);
  const rows = sheet.getDataRange().getValues();
  const year = new Date().getFullYear();

  let total = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (String(row[1] || "").trim().toLowerCase() !== "donation") continue;

    const date = parseDate_(row[0]);
    const amount = Number(row[2]);
    if (!date || !Number.isFinite(amount) || amount === 0) continue;
    if (date.getFullYear() !== year) continue;

    total += Math.abs(amount);
  }

  return total;
}

function getPhotos_() {
  const sheet = ss_().getSheetByName(PHOTO_SHEET);
  if (!sheet) return [];

  const rows = sheet.getDataRange().getValues();
  const out = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const active = row[4] === true || String(row[4]).trim().toUpperCase() === "TRUE";
    if (!active || !row[1]) continue;

    out.push({
      id: String(row[0]),
      url: "https://drive.google.com/thumbnail?id=" + String(row[1]) + "&sz=w1200",
      caption: String(row[2] || ""),
      date: String(row[3] || ""),
    });
  }

  return out.reverse();
}

// ============================================================
// 잠금 / 기록
// ============================================================

function cache_() {
  return CacheService.getScriptCache();
}

function countFailure_() {
  const count = Number(cache_().get("fail") || 0) + 1;
  cache_().put("fail", String(count), FAIL_WINDOW_SEC);
  if (count >= FAIL_LIMIT) lockFor_(LOCK_MINUTES);
}

function clearFailures_() {
  cache_().remove("fail");
}

function lockFor_(minutes) {
  cache_().put("lockUntil", String(Date.now() + minutes * 60000), minutes * 60);
}

function lockRemaining_() {
  const until = Number(cache_().get("lockUntil") || 0);
  const left = until - Date.now();
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

// 시도한 입력을 그대로 시트에 쓰면 수식으로 실행될 수 있으므로
// safeCell_ 로 무력화한 뒤 앞부분만 남깁니다.
function logSecurity_(reason, sample) {
  try {
    const sheet = ss_().getSheetByName(LOG_SHEET);
    if (!sheet) return;
    sheet.appendRow([
      Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm:ss"),
      reason,
      safeCell_(String(sample).slice(0, 40)),
    ]);
  } catch (err) {
    // 기록 실패가 응답을 막지 않게 합니다.
  }
}

// ============================================================
// 공용
// ============================================================

// 스프레드시트는 = + - @ 로 시작하는 값을 수식으로 실행합니다.
// 앞에 작은따옴표를 붙이면 문자열로 고정됩니다.
function safeCell_(text) {
  const s = String(text == null ? "" : text);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

// 길이가 같으면 모든 문자를 비교해 응답 시간 차이를 줄입니다.
function sameToken_(a, b) {
  if (!b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || "";
}

function ss_() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function sheetByName_(name) {
  const sheet = ss_().getSheetByName(name);
  if (!sheet) throw new Error("시트 없음: " + name);
  return sheet;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// 최초 1회 실행
// ============================================================

function setupOkdodan() {
  const ss = ss_();

  if (!ss.getSheetByName(PHOTO_SHEET)) {
    ss.insertSheet(PHOTO_SHEET)
      .appendRow(["id", "fileId", "caption", "date", "active"]);
  }

  if (!ss.getSheetByName(LOG_SHEET)) {
    ss.insertSheet(LOG_SHEET)
      .appendRow(["시각", "사유", "입력 샘플"]);
  }

  const props = PropertiesService.getScriptProperties();

  if (!props.getProperty("PHOTO_FOLDER_ID")) {
    const folder = DriveApp.createFolder("옥도단 사진첩");
    props.setProperty("PHOTO_FOLDER_ID", folder.getId());
  }

  const ledger = ss.getSheetByName(SHEET_NAME);
  if (ledger && !ledger.getRange("F1").getValue()) {
    ledger.getRange("F1").setValue("표시명");
  }

  Logger.log("설정 완료. ADMIN_TOKEN 이 스크립트 속성에 있는지 확인하세요: "
    + (props.getProperty("ADMIN_TOKEN") ? "있음" : "없음 — 지금 넣으세요"));
}
