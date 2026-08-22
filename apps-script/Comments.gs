// 옥도단 후원 — 댓글 (구글 로그인 필요)
// 게시판: expenses(사용 내역) / donations(후원 내역) / photos(사진첩)
//
// 구글 로그인으로 신원을 확인하되, 사이트에 보이는 것은 본인이 정한 닉네임뿐입니다.
// 이메일은 comments 시트에만 남고 공개 JSON으로 절대 나가지 않습니다.
// 이메일이 있어야 차단(밴)이 실제로 작동합니다.

const COMMENT_SHEET = "comments";
const COMMENT_TRASH = "comments_삭제";
const BANNED_SHEET = "banned";
const USERS_SHEET = "users";
const BOARDS = ["expenses", "donations", "photos"];

const NICK_MAX = 20;
const BODY_MAX = 200;
const COMMENT_SHOW = 50;

// 도배 제한: 10분에 20개
const COMMENT_LIMIT = 20;
const COMMENT_WINDOW_SEC = 600;

// 관리자인 척하는 닉네임 차단
const NICK_BLOCKED = ["관리자", "운영자", "옥도단", "admin", "administrator",
  "운영진", "어드민", "에드민", "운영", "공지", "학교", "솔가람"];

// 구글 로그인 클라이언트 ID (공개되어도 되는 값입니다)
const GOOGLE_CLIENT_ID = "719302024935-25psog12r9dd0facogtph49v6o48eh4h.apps.googleusercontent.com";

// 학교 구글 계정만 받고 싶으면 여기에 도메인을 넣으세요. 예: "solgaram.hs.kr"
// 비워 두면 아무 구글 계정이나 됩니다.
const ALLOWED_DOMAIN = "";

// 브라우저가 보낸 로그인 토큰이 진짜인지 구글에 직접 물어봅니다.
// 위조된 토큰은 여기서 걸립니다.
function verifyGoogleToken_(idToken) {
  if (!idToken) return null;

  try {
    const res = UrlFetchApp.fetch(
      "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return null;

    const info = JSON.parse(res.getContentText());

    // 우리 사이트용으로 발급된 토큰이 맞는지
    if (info.aud !== GOOGLE_CLIENT_ID) return null;

    // 만료되지 않았는지
    if (Number(info.exp) * 1000 < Date.now()) return null;

    if (!info.email || info.email_verified !== "true") return null;

    if (ALLOWED_DOMAIN && info.email.slice(-(ALLOWED_DOMAIN.length + 1)) !== "@" + ALLOWED_DOMAIN) {
      return null;
    }

    return String(info.email).toLowerCase();
  } catch (err) {
    return null;
  }
}

function isBanned_(email) {
  const sheet = ss_().getSheetByName(BANNED_SHEET);
  if (!sheet) return false;

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === email) return true;
  }
  return false;
}

// 한 계정이 댓글마다 다른 닉네임을 쓰면 한 사람이 여러 명처럼 보입니다.
// 처음 쓴 닉네임을 users 시트에 적어 두고 그 뒤로는 그것만 씁니다.
function lockedNickname_(email) {
  const sheet = ss_().getSheetByName(USERS_SHEET);
  if (!sheet) return "";

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === email) {
      return String(rows[i][1] || "").trim();
    }
  }
  return "";
}

function addComment_(req) {
  const email = verifyGoogleToken_(req.idToken);
  if (!email) return json_({ ok: false, error: "login_required" });

  if (isBanned_(email)) return json_({ ok: false, error: "banned" });

  const locked = lockedNickname_(email);

  // 화면이 "내 닉네임이 뭔지"만 물어보는 경우 (댓글은 쓰지 않음)
  if (req.probe === true) {
    return json_({ ok: true, nickname: locked });
  }

  const board = String(req.board || "");
  if (BOARDS.indexOf(board) < 0) return json_({ ok: false, error: "bad_board" });

  // 이미 정해진 닉네임이 있으면 보내온 값은 무시합니다.
  const nickname = locked || String(req.nickname || "").trim().slice(0, NICK_MAX);
  const body = String(req.body || "").trim().slice(0, BODY_MAX);
  if (!nickname || !body) return json_({ ok: false, error: "empty" });

  if (!locked) {
    const flat = nickname.toLowerCase().replace(/\s/g, "");
    for (let i = 0; i < NICK_BLOCKED.length; i++) {
      if (flat.indexOf(NICK_BLOCKED[i]) >= 0) return json_({ ok: false, error: "nick_blocked" });
    }
  }

  // 등록 버튼 연타로 같은 댓글이 여러 번 올라가는 것을 막습니다.
  const fingerprint = email + "|" + board + "|" + body;
  if (cache_().get("dup:" + fingerprint)) {
    return json_({ ok: true, nickname: nickname, duplicate: true });
  }
  cache_().put("dup:" + fingerprint, "1", 120);

  const count = Number(cache_().get("cmt") || 0) + 1;
  cache_().put("cmt", String(count), COMMENT_WINDOW_SEC);
  if (count > COMMENT_LIMIT) return json_({ ok: false, error: "too_many" });

  const sheet = ss_().getSheetByName(COMMENT_SHEET);
  if (!sheet) return json_({ ok: false, error: "not_ready" });

  // safeCell_ 로 = + - @ 를 무력화해 시트에서 수식으로 실행되지 않게 합니다.
  sheet.appendRow([
    Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm"),
    board,
    safeCell_(nickname),
    safeCell_(body),
    true,
    safeCell_(email),
    String(Date.now()),
  ]);

  // 처음 쓴 사람이면 닉네임을 확정해 둡니다.
  if (!locked) {
    const users = ss_().getSheetByName(USERS_SHEET);
    if (users) {
      users.appendRow([
        email,
        safeCell_(nickname),
        Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm"),
      ]);
    }
  }

  return json_({ ok: true, nickname: nickname });
}

// 관리자만: 댓글을 휴지통 시트로 옮기고 원본에서 지웁니다.
// req.ban 이 true 면 작성자까지 차단합니다.
function hideComment_(req) {
  const id = String(req.id || "");
  const sheet = sheetByName_(COMMENT_SHEET);
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (commentId_(rows[i], i) !== id) continue;

    const email = String(rows[i][5] || "").trim().toLowerCase();

    moveToTrash_(sheet, COMMENT_TRASH, i + 1, rows[i]);

    if (req.ban === true) {
      if (!email) return json_({ ok: true, banned: false });

      const banned = ss_().getSheetByName(BANNED_SHEET);
      if (banned && !isBanned_(email)) {
        banned.appendRow([
          email,
          Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm"),
        ]);
      }
      return json_({ ok: true, banned: true });
    }

    return json_({ ok: true, banned: false });
  }

  return json_({ ok: false, error: "not_found" });
}

// 지운 내용을 휴지통 시트에 옮겨 둡니다.
// 원본 시트는 깨끗해지고, 필요하면 되살릴 수 있습니다.
function moveToTrash_(sheet, trashName, rowNumber, values) {
  const ss = ss_();
  let trash = ss.getSheetByName(trashName);

  if (!trash) {
    trash = ss.insertSheet(trashName);
    trash.appendRow(["삭제 시각"].concat(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]));
  }

  trash.appendRow(
    [Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm")].concat(values)
  );

  sheet.deleteRow(rowNumber);
}

function commentId_(row, index) {
  const id = String(row[6] || "").trim();
  if (id) return id;
  return String(index) + "-" + commentAt_(row[0]);
}

// 시트가 "2026-08-20 21:54"를 날짜로 바꿔 버리므로 다시 문자열로 만듭니다.
function commentAt_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, TIMEZONE, "MM-dd HH:mm");
  }
  return String(value || "");
}

// 공개되는 것은 닉네임까지입니다. 이메일은 여기서 절대 내보내지 않습니다.
function getComments_() {
  const sheet = ss_().getSheetByName(COMMENT_SHEET);
  const out = { expenses: [], donations: [], photos: [] };
  if (!sheet) return out;

  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const board = String(row[1] || "").trim();
    if (!out[board]) continue;

    const shown = row[4] === true || String(row[4]).trim().toUpperCase() === "TRUE";
    if (!shown) continue;

    out[board].push({
      id: commentId_(row, i),
      at: commentAt_(row[0]),
      nickname: String(row[2] || ""),
      body: String(row[3] || ""),
    });
  }

  BOARDS.forEach(function (board) {
    out[board] = out[board].reverse().slice(0, COMMENT_SHOW);
  });

  return out;
}

// 최초 1회 실행 (여러 번 실행해도 안전합니다)
function 댓글시트_만들기() {
  const ss = ss_();

  const comments = ss.getSheetByName(COMMENT_SHEET);
  if (!comments) {
    ss.insertSheet(COMMENT_SHEET)
      .appendRow(["시각", "게시판", "닉네임", "내용", "공개", "이메일(비공개)", "id"]);
    Logger.log("comments 시트를 만들었습니다.");
  } else {
    if (!comments.getRange("F1").getValue()) comments.getRange("F1").setValue("이메일(비공개)");
    if (!comments.getRange("G1").getValue()) comments.getRange("G1").setValue("id");
  }

  if (!ss.getSheetByName(BANNED_SHEET)) {
    ss.insertSheet(BANNED_SHEET).appendRow(["이메일", "차단 시각"]);
    Logger.log("banned 시트를 만들었습니다.");
  }

  Logger.log("설정 완료.");
}
