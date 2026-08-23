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

// 닉네임 변경 간격.
// 바꿀 때마다 지난 댓글의 이름까지 전부 고쳐 쓰므로, 연타하면 시트가 통째로 갈립니다.
// 읽는 사람 입장에서도 이름이 자주 바뀌면 누가 누군지 알 수 없습니다.
const NICK_COOLDOWN_DAYS = 7;

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

// users 시트에서 이 계정의 행을 찾습니다.
// A=이메일, B=닉네임, C=등록 시각, D=닉네임 변경 시각(밀리초)
// 못 찾으면 row 가 0 입니다. 시트 행 번호라서 1부터 셉니다.
function userRow_(email) {
  const sheet = ss_().getSheetByName(USERS_SHEET);
  if (!sheet) return { sheet: null, row: 0, nickname: "", changedAt: 0 };

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() === email) {
      return {
        sheet: sheet,
        row: i + 1,
        nickname: String(rows[i][1] || "").trim(),
        changedAt: Number(rows[i][3]) || 0,
      };
    }
  }
  return { sheet: sheet, row: 0, nickname: "", changedAt: 0 };
}

// 한 계정이 댓글마다 다른 닉네임을 쓰면 한 사람이 여러 명처럼 보입니다.
// 처음 쓴 닉네임을 users 시트에 적어 두고, 바꾸려면 아래 쿨다운을 거칩니다.
function lockedNickname_(email) {
  return userRow_(email).nickname;
}

// 닉네임 검사. 처음 정할 때와 바꿀 때 같은 기준을 써야 합니다.
// 전에는 처음 정할 때만 검사해서, 바꾸기로 "관리자"를 통과시킬 수 있었습니다.
// 문제가 없으면 빈 문자열을 돌려줍니다.
function nickError_(nickname) {
  if (!nickname) return "empty";

  const flat = nickname.toLowerCase().replace(/\s/g, "");
  for (let i = 0; i < NICK_BLOCKED.length; i++) {
    if (flat.indexOf(NICK_BLOCKED[i]) >= 0) return "nick_blocked";
  }
  return "";
}

// 다음에 닉네임을 바꿀 수 있을 때까지 남은 초. 지금 바꿀 수 있으면 0.
function nickCooldownSec_(changedAt) {
  if (!changedAt) return 0;

  const passed = Date.now() - changedAt;
  const need = NICK_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  if (passed >= need) return 0;

  return Math.ceil((need - passed) / 1000);
}

// 닉네임을 바꾸면 지난 댓글에 남은 옛 이름도 같이 고칩니다.
// 그러지 않으면 한 사람이 이름 두 개로 보여, 닉네임을 고정한 이유가 없어집니다.
//
// ponytail: 행마다 한 번씩 씁니다. 댓글이 수천 개가 되면 느려지므로,
// 그때는 열 전체를 한 번에 읽고 setValues 로 한 번에 쓰도록 바꾸면 됩니다.
// 쿨다운이 있어 자주 돌지는 않습니다.
function renameComments_(email, nickname) {
  const sheet = ss_().getSheetByName(COMMENT_SHEET);
  if (!sheet) return 0;

  const rows = sheet.getDataRange().getValues();
  let changed = 0;

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][5] || "").trim().toLowerCase() !== email) continue;
    sheet.getRange(i + 1, 3).setValue(safeCell_(nickname));
    changed++;
  }
  return changed;
}

// 닉네임 바꾸기. doPost 를 건드리지 않으려고 probe 와 같은 자리에서 처리합니다.
function changeNickname_(email, requested, user) {
  const nickname = String(requested || "").trim().slice(0, NICK_MAX);

  const bad = nickError_(nickname);
  if (bad) return json_({ ok: false, error: bad });

  // 아직 닉네임이 없으면 바꾸는 것이 아니라 처음 정하는 것입니다.
  if (!user.nickname) return json_({ ok: false, error: "no_nickname" });

  if (nickname === user.nickname) {
    return json_({ ok: true, nickname: nickname, cooldownSec: nickCooldownSec_(user.changedAt) });
  }

  const waitSec = nickCooldownSec_(user.changedAt);
  if (waitSec > 0) {
    return json_({ ok: false, error: "nick_cooldown", retryAfterSec: waitSec });
  }

  if (!user.sheet || !user.row) return json_({ ok: false, error: "not_ready" });

  const now = Date.now();
  user.sheet.getRange(user.row, 2).setValue(safeCell_(nickname));
  user.sheet.getRange(user.row, 4).setValue(String(now));

  renameComments_(email, nickname);

  return json_({
    ok: true,
    nickname: nickname,
    cooldownSec: nickCooldownSec_(now),
  });
}

function addComment_(req) {
  const email = verifyGoogleToken_(req.idToken);
  if (!email) return json_({ ok: false, error: "login_required" });

  if (isBanned_(email)) return json_({ ok: false, error: "banned" });

  const user = userRow_(email);
  const locked = user.nickname;

  // 화면이 "내 닉네임이 뭔지"만 물어보는 경우 (댓글은 쓰지 않음)
  if (req.probe === true) {
    return json_({
      ok: true,
      nickname: locked,
      cooldownSec: nickCooldownSec_(user.changedAt),
    });
  }

  // 닉네임 바꾸기 (댓글은 쓰지 않음)
  if (req.changeNickname === true) {
    return changeNickname_(email, req.nickname, user);
  }

  const board = String(req.board || "");
  if (BOARDS.indexOf(board) < 0) return json_({ ok: false, error: "bad_board" });

  // 이미 정해진 닉네임이 있으면 보내온 값은 무시합니다.
  const nickname = locked || String(req.nickname || "").trim().slice(0, NICK_MAX);
  const body = String(req.body || "").trim().slice(0, BODY_MAX);
  if (!nickname || !body) return json_({ ok: false, error: "empty" });

  if (!locked) {
    const bad = nickError_(nickname);
    if (bad) return json_({ ok: false, error: bad });
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
      // D열(변경 시각)은 비워 둡니다. 처음 한 번은 쿨다운 없이 바꿀 수 있습니다.
      users.appendRow([
        email,
        safeCell_(nickname),
        Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd HH:mm"),
        "",
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

  // users 시트가 없으면 lockedNickname_ 이 늘 빈 값을 돌려주어
  // 닉네임 고정이 통째로 동작하지 않습니다.
  const users = ss.getSheetByName(USERS_SHEET);
  if (!users) {
    ss.insertSheet(USERS_SHEET)
      .appendRow(["이메일", "닉네임", "등록 시각", "닉네임 변경 시각"]);
    Logger.log("users 시트를 만들었습니다.");
  } else if (!users.getRange("D1").getValue()) {
    users.getRange("D1").setValue("닉네임 변경 시각");
  }

  Logger.log("설정 완료.");
}
