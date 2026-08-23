// 닉네임 바꾸기 자체 점검.
//
//   node apps-script/nickname.test.js
//
// Apps Script 는 브라우저도 노드도 아니라서 그냥은 못 돌립니다.
// Comments.gs 를 읽어서, 필요한 구글 함수만 가짜로 만들어 놓고 실행합니다.
// 쿨다운을 잘못 고치면 여기서 바로 터집니다.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "Comments.gs"), "utf8");

// ------------------------------------------------------------
// 가짜 시트
// ------------------------------------------------------------

function makeSheet(rows) {
  return {
    rows: rows,
    getDataRange: () => ({ getValues: () => rows }),
    getRange: (row, col) => ({
      getValue: () => rows[row - 1][col - 1],
      setValue: (value) => { rows[row - 1][col - 1] = value; },
    }),
    appendRow: (row) => rows.push(row),
  };
}

function makeWorld(users, comments) {
  const sheets = {
    users: makeSheet(users),
    comments: makeSheet(comments),
  };

  const context = {
    TIMEZONE: "Asia/Seoul",
    ss_: () => ({ getSheetByName: (name) => sheets[name] || null }),
    safeCell_: (text) => text,
    json_: (obj) => obj,
    cache_: () => ({ get: () => null, put: () => {} }),
    Utilities: { formatDate: () => "2026-08-23 12:00" },
    UrlFetchApp: { fetch: () => { throw new Error("네트워크 안 씁니다"); } },
    Logger: { log: () => {} },
    Date: Date,
    Math: Math,
    Number: Number,
    String: String,
    JSON: JSON,
  };

  vm.createContext(context);

  // const 는 vm context 의 전역 속성이 되지 않습니다.
  // 테스트가 진짜 상수를 보도록 밖으로 한 번 꺼냅니다.
  const expose = [
    source,
    "globalThis.NICK_COOLDOWN_DAYS = NICK_COOLDOWN_DAYS;",
  ].join("\n");

  vm.runInContext(expose, context);
  return { context, sheets };
}

const DAY = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------
// 닉네임 검사
// ------------------------------------------------------------

{
  const { context } = makeWorld([["이메일", "닉네임", "등록", "변경"]], []);

  assert.strictEqual(context.nickError_("옥희팬"), "");
  assert.strictEqual(context.nickError_(""), "empty");

  // 관리자인 척하는 닉네임은 처음 정할 때든 바꿀 때든 똑같이 막혀야 합니다.
  assert.strictEqual(context.nickError_("관리자"), "nick_blocked");
  assert.strictEqual(context.nickError_("옥도단 운영자"), "nick_blocked");
  assert.strictEqual(context.nickError_("운 영 자"), "nick_blocked", "띄어쓰기로 못 피합니다");
  assert.strictEqual(context.nickError_("ADMIN"), "nick_blocked", "대문자로도 못 피합니다");
}

// ------------------------------------------------------------
// 쿨다운 계산
// ------------------------------------------------------------

{
  const { context } = makeWorld([["이메일", "닉네임", "등록", "변경"]], []);
  const days = context.NICK_COOLDOWN_DAYS;

  assert.strictEqual(context.nickCooldownSec_(0), 0, "한 번도 안 바꿨으면 바로 됩니다");
  assert.strictEqual(context.nickCooldownSec_(Date.now() - (days + 1) * DAY), 0);

  assert.strictEqual(typeof days, "number", "상수를 못 읽으면 아래 검사가 전부 헛돕니다");

  const left = context.nickCooldownSec_(Date.now() - 1 * DAY);
  assert.ok(left > 0, "하루밖에 안 지났으면 기다려야 합니다");
  assert.ok(left <= (days - 1) * 24 * 60 * 60 + 5, "남은 시간이 터무니없이 크면 안 됩니다");

  // 딱 경계에서 열려야 합니다.
  assert.strictEqual(context.nickCooldownSec_(Date.now() - days * DAY), 0);
}

// ------------------------------------------------------------
// 바꾸기: 성공하면 지난 댓글 이름까지 같이 바뀝니다
// ------------------------------------------------------------

{
  const users = [
    ["이메일", "닉네임", "등록", "변경"],
    ["a@example.com", "옛이름", "2026-08-01 10:00", ""],
    ["b@example.com", "남", "2026-08-01 10:00", ""],
  ];
  const comments = [
    ["시각", "게시판", "닉네임", "내용", "공개", "이메일", "id"],
    ["t1", "photos", "옛이름", "귀엽다", true, "a@example.com", "1"],
    ["t2", "photos", "남", "나도", true, "b@example.com", "2"],
    ["t3", "photos", "옛이름", "또 왔음", true, "a@example.com", "3"],
  ];

  const { context, sheets } = makeWorld(users, comments);

  const res = context.changeNickname_(
    "a@example.com",
    "새이름",
    context.userRow_("a@example.com")
  );

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.nickname, "새이름");
  assert.ok(res.cooldownSec > 0, "바꾼 직후에는 쿨다운이 걸려 있어야 합니다");

  assert.strictEqual(sheets.users.rows[1][1], "새이름");
  assert.ok(Number(sheets.users.rows[1][3]) > 0, "변경 시각이 기록돼야 합니다");

  // 옛 이름이 남아 있으면 한 사람이 두 명으로 보입니다.
  assert.strictEqual(sheets.comments.rows[1][2], "새이름");
  assert.strictEqual(sheets.comments.rows[3][2], "새이름");

  // 남의 댓글은 건드리면 안 됩니다.
  assert.strictEqual(sheets.comments.rows[2][2], "남");
  assert.strictEqual(sheets.users.rows[2][1], "남");
}

// ------------------------------------------------------------
// 바꾸기: 쿨다운 안에서는 거절
// ------------------------------------------------------------

{
  const users = [
    ["이메일", "닉네임", "등록", "변경"],
    ["a@example.com", "이름", "2026-08-01 10:00", String(Date.now() - 1 * DAY)],
  ];
  const comments = [
    ["시각", "게시판", "닉네임", "내용", "공개", "이메일", "id"],
    ["t1", "photos", "이름", "글", true, "a@example.com", "1"],
  ];

  const { context, sheets } = makeWorld(users, comments);

  const res = context.changeNickname_(
    "a@example.com",
    "또바꿈",
    context.userRow_("a@example.com")
  );

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, "nick_cooldown");
  assert.ok(res.retryAfterSec > 0);

  // 거절했으면 시트는 그대로여야 합니다.
  assert.strictEqual(sheets.users.rows[1][1], "이름");
  assert.strictEqual(sheets.comments.rows[1][2], "이름");
}

// ------------------------------------------------------------
// 바꾸기: 막힌 닉네임은 쿨다운과 상관없이 거절
// ------------------------------------------------------------

{
  const users = [
    ["이메일", "닉네임", "등록", "변경"],
    ["a@example.com", "이름", "2026-08-01 10:00", ""],
  ];
  const { context, sheets } = makeWorld(users, []);

  const res = context.changeNickname_(
    "a@example.com",
    "옥도단관리자",
    context.userRow_("a@example.com")
  );

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, "nick_blocked");
  assert.strictEqual(sheets.users.rows[1][1], "이름");
}

// ------------------------------------------------------------
// 바꾸기: 같은 이름으로 바꾸면 쿨다운을 새로 걸지 않습니다
// ------------------------------------------------------------

{
  const users = [
    ["이메일", "닉네임", "등록", "변경"],
    ["a@example.com", "이름", "2026-08-01 10:00", ""],
  ];
  const { context, sheets } = makeWorld(users, []);

  const res = context.changeNickname_(
    "a@example.com",
    "이름",
    context.userRow_("a@example.com")
  );

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.cooldownSec, 0, "안 바뀌었으니 계속 바꿀 수 있어야 합니다");
  assert.strictEqual(sheets.users.rows[1][3], "", "변경 시각을 건드리면 안 됩니다");
}

// ------------------------------------------------------------
// 바꾸기: 닉네임이 아직 없으면 바꾸는 것이 아닙니다
// ------------------------------------------------------------

{
  const { context } = makeWorld([["이메일", "닉네임", "등록", "변경"]], []);

  const res = context.changeNickname_(
    "없는사람@example.com",
    "새이름",
    context.userRow_("없는사람@example.com")
  );

  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, "no_nickname");
}

console.log("닉네임 점검 통과");
