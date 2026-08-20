// 옥도단 후원 — 댓글 (로그인 없이 누구나 씁니다)
//
// 게시판은 세 곳입니다: expenses(사용 내역) / donations(후원 내역) / photos(사진첩)
//
// 로그인이 없으므로 닉네임은 자기가 정합니다. 즉 아무나 아무 이름이나 쓸 수 있고,
// 같은 닉네임이 같은 사람이라는 보장이 없습니다. 관리자·운영자처럼 헷갈릴 이름만 막습니다.

const COMMENT_SHEET = "comments";

const BOARDS = ["expenses", "donations", "photos"];

const NICK_MAX = 20;
const BODY_MAX = 200;

// 게시판 하나당 최근 몇 개까지 내려줄지
const COMMENT_SHOW = 50;

// 도배 제한: 10분에 20개까지
const COMMENT_LIMIT = 20;
const COMMENT_WINDOW_SEC = 600;

// 관리자인 척하는 닉네임 차단
const NICK_BLOCKED = ["관리자", "운영자", "옥도단", "admin", "administrator", "운영진"];

function addComment_(req) {
  const board = String(req.board || "");
  if (BOARDS.indexOf(board) < 0) return json_({ ok: false, error: "bad_board" });

  const nickname = String(req.nickname || "").trim().slice(0, NICK_MAX);
  const body = String(req.body || "").trim().slice(0, BODY_MAX);

  if (!nickname || !body) return json_({ ok: false, error: "empty" });

  const flat = nickname.toLowerCase().replace(/\s/g, "");
  for (let i = 0; i < NICK_BLOCKED.length; i++) {
    if (flat.indexOf(NICK_BLOCKED[i]) >= 0) {
      return json_({ ok: false, error: "nick_blocked" });
    }
  }

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
  ]);

  return json_({ ok: true });
}

// 관리자만: 문제 댓글을 목록에서 내립니다. 행은 지우지 않고 공개만 끕니다.
function hideComment_(req) {
  const id = String(req.id || "");
  const sheet = sheetByName_(COMMENT_SHEET);
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (commentId_(rows[i], i) === id) {
      sheet.getRange(i + 1, 5).setValue(false);
      return json_({ ok: true });
    }
  }

  return json_({ ok: false, error: "not_found" });
}

function commentId_(row, index) {
  return String(index) + "-" + commentAt_(row[0]);
}

// 시트가 "2026-08-20 21:54"를 날짜로 바꿔 버리므로 다시 문자열로 만듭니다.
function commentAt_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, TIMEZONE, "MM-dd HH:mm");
  }
  return String(value || "");
}

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

  // 최신 것이 위로 오게 하고, 게시판마다 최근 것만 남깁니다.
  BOARDS.forEach(function (board) {
    out[board] = out[board].reverse().slice(0, COMMENT_SHOW);
  });

  return out;
}

// 최초 1회: comments 시트 만들기
function 댓글시트_만들기() {
  const ss = ss_();
  if (!ss.getSheetByName(COMMENT_SHEET)) {
    ss.insertSheet(COMMENT_SHEET).appendRow(["시각", "게시판", "닉네임", "내용", "공개"]);
    Logger.log("comments 시트를 만들었습니다.");
  } else {
    Logger.log("comments 시트가 이미 있습니다.");
  }
}
