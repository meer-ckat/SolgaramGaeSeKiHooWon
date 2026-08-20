// 옥도단 후원 — 현황 로딩 + 지출 내역 + 계좌 복사

const CONFIG = {
  // Apps Script 웹 앱 배포 URL (README 참고)
  ledgerEndpoint: "https://script.google.com/macros/s/AKfycbzPcRxtHiSduSJUSHVbA45sGkInLf8mjmgz_XzAwASZEddf7IifiFY1N2IHr6bqyMUKug/exec",
};

const KRW = new Intl.NumberFormat("ko-KR");

function won(n) {
  return KRW.format(n) + "원";
}

function renderSummary(data) {
  const goal = Number(data.goal) || 0;
  const received = Number(data.received) || 0;
  const spent = Number(data.spent) || 0;
  const balance = Number(data.balance) || received - spent;

  const percent = goal > 0
    ? Math.round((received / goal) * 100)
    : 0;

  document.getElementById("received").textContent = won(received);
  document.getElementById("goal").textContent = won(goal);
  document.getElementById("spent").textContent = won(spent);
  document.getElementById("balance").textContent = won(balance);

  document.getElementById("percent").textContent =
    "목표의 " + percent + "% 달성";

  document.getElementById("bar-fill").style.width =
    Math.min(percent, 100) + "%";

  document.getElementById("bar").setAttribute(
    "aria-valuenow",
    Math.min(percent, 100)
  );
}

function renderExpenses(expenses) {
  const body = document.getElementById("expenses-body");
  body.textContent = "";

  if (!expenses.length) {
    body.innerHTML = '<tr><td colspan="3" class="empty">아직 공개된 지출 내역이 없습니다.</td></tr>';
    return;
  }

  const sorted = expenses.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));

  for (const item of sorted) {
    const tr = document.createElement("tr");

    const date = document.createElement("td");
    // "2026-08-20" -> "08.20"
    date.textContent = String(item.date).slice(5).replace("-", ".");

    const desc = document.createElement("td");
    desc.textContent = item.description;

    const amount = document.createElement("td");
    amount.className = "num";
    amount.textContent = won(Number(item.amount) || 0);

    tr.append(date, desc, amount);
    body.appendChild(tr);
  }
}

function renderDonations(donations) {
  const body = document.getElementById("donations-body");
  body.textContent = "";

  if (!donations.length) {
    body.innerHTML = '<tr><td colspan="3" class="empty">아직 공개된 후원 내역이 없습니다.</td></tr>';
    return;
  }

  const sorted = donations.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));

  for (const item of sorted) {
    const tr = document.createElement("tr");

    const date = document.createElement("td");
    date.textContent = String(item.date).slice(5).replace("-", ".");

    const name = document.createElement("td");
    name.textContent = item.name || "익명";

    const amount = document.createElement("td");
    amount.className = "num";
    amount.textContent = won(Number(item.amount) || 0);

    tr.append(date, name, amount);
    body.appendChild(tr);
  }
}

// 10초마다 다시 그리면 사진이 매번 깜빡이므로, 목록이 바뀌었을 때만 그립니다.
let lastPhotoKey = null;

function renderGallery(photos) {
  const key = photos.map((p) => p.id + ":" + p.caption).join("|");
  if (key === lastPhotoKey) return;
  lastPhotoKey = key;

  const list = document.getElementById("gallery");
  list.textContent = "";

  if (!photos.length) {
    const li = document.createElement("li");
    li.className = "gallery-empty";
    li.textContent = "아직 등록된 사진이 없습니다.";
    list.appendChild(li);
    return;
  }

  for (const photo of photos) {
    // 구글 드라이브 이미지 주소만 허용 (스크립트 URL 차단)
    if (!/^https:\/\/(drive|lh3)\.google(usercontent)?\.com\//.test(photo.url || "")) continue;

    const li = document.createElement("li");

    const img = document.createElement("img");
    img.src = photo.url;
    img.alt = photo.caption || "옥희와 도치 사진";
    img.loading = "lazy";

    // 격자에서는 잘려 보이므로, 누르면 원본 비율로 크게 띄웁니다.
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gallery-item";
    button.setAttribute("aria-label", (photo.caption || "사진") + " 크게 보기");
    button.appendChild(img);
    button.addEventListener("click", () => openLightbox(photo));
    li.appendChild(button);

    if (photo.caption) {
      const cap = document.createElement("p");
      cap.className = "gallery-caption";
      cap.textContent = photo.caption;
      li.appendChild(cap);
    }

    list.appendChild(li);
  }
}

function openLightbox(photo) {
  const img = document.getElementById("lightbox-img");

  // 격자용보다 큰 크기를 요청합니다.
  img.src = photo.url.replace(/sz=w\d+/, "sz=w2000");
  img.alt = photo.caption || "옥희와 도치 사진";

  document.getElementById("lightbox-caption").textContent = photo.caption || "";
  document.getElementById("lightbox").showModal();
}

const lightbox = document.getElementById("lightbox");

// 사진 바깥(어두운 배경)을 누르면 닫습니다. Esc는 dialog가 알아서 처리합니다.
lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox) lightbox.close();
});

document.getElementById("lightbox-close").addEventListener("click", () => {
  lightbox.close();
});

// 닫을 때 이미지를 비워 메모리를 잡아두지 않게 합니다.
lightbox.addEventListener("close", () => {
  document.getElementById("lightbox-img").removeAttribute("src");
});

// ============================================================
// 댓글
// ============================================================

// 로그인이 없어 닉네임은 본인이 정합니다.
// 같은 닉네임이 같은 사람이라는 보장은 없습니다.

// 다시 그릴 때 입력 중인 글이 날아가지 않게, 바뀐 경우에만 그립니다.
const lastCommentKey = {};

function renderComments(all) {
  document.querySelectorAll(".comments").forEach((box) => {
    const board = box.dataset.board;
    const items = Array.isArray(all[board]) ? all[board] : [];

    const key = items.map((c) => c.id).join("|");
    if (key === lastCommentKey[board]) return;
    lastCommentKey[board] = key;

    const list = box.querySelector(".comment-list");
    list.textContent = "";

    if (!items.length) {
      const li = document.createElement("li");
      li.className = "comment-empty";
      li.textContent = "아직 댓글이 없습니다.";
      list.appendChild(li);
      return;
    }

    for (const item of items) {
      const li = document.createElement("li");
      li.className = "comment";

      const nick = document.createElement("span");
      nick.className = "comment-nickname";
      nick.textContent = item.nickname;

      const sep = document.createElement("span");
      sep.className = "comment-sep";
      sep.textContent = " - ";

      const body = document.createElement("span");
      body.textContent = item.body;

      const at = document.createElement("time");
      at.className = "comment-at";
      at.textContent = item.at;

      li.append(nick, sep, body, at);
      list.appendChild(li);
    }
  });
}

async function submitComment(box) {
  const board = box.dataset.board;
  const body = box.querySelector(".comment-body");
  const note = box.querySelector(".comment-msg");

  const nickname = document.getElementById("my-nickname").value.trim();

  note.className = "form-msg comment-msg";

  if (!googleToken) {
    note.className = "form-msg comment-msg form-msg-bad";
    note.textContent = "구글 로그인이 필요합니다.";
    return;
  }

  if (!nickname) {
    note.className = "form-msg comment-msg form-msg-bad";
    note.textContent = "닉네임을 입력해 주세요.";
    return;
  }

  note.textContent = "등록 중입니다.";

  try {
    const res = await fetch(CONFIG.ledgerEndpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "addComment",
        board: board,
        nickname: nickname,
        body: body.value,
        idToken: googleToken,
      }),
    });
    const data = await res.json();

    if (data.ok) {
      note.textContent = "";
      body.value = "";
      lastCommentKey[board] = null;
      loadLedger();
      return;
    }

    note.className = "form-msg comment-msg form-msg-bad";

    if (data.error === "nick_blocked") {
      note.textContent = "관리자·운영자처럼 헷갈리는 닉네임은 쓸 수 없습니다.";
    } else if (data.error === "too_many") {
      note.textContent = "댓글이 너무 빠르게 올라오고 있습니다. 잠시 후 다시 시도해 주세요.";
    } else if (data.error === "banned") {
      note.textContent = "댓글 작성이 제한된 계정입니다.";
    } else if (data.error === "login_required") {
      note.textContent = "로그인이 만료되었습니다. 다시 로그인해 주세요.";
      setLoggedOut();
    } else {
      note.textContent = "등록하지 못했습니다.";
    }
  } catch (err) {
    note.className = "form-msg comment-msg form-msg-bad";
    note.textContent = "서버에 연결하지 못했습니다.";
  }
}

// ============================================================
// 구글 로그인
// ============================================================
//
// 구글이 서명한 토큰을 받아 Apps Script로 넘깁니다.
// 비밀번호는 이 사이트가 만지지도 저장하지도 않습니다.
// 이메일은 차단 용도로 시트에만 남고 화면에는 닉네임만 나옵니다.

const GOOGLE_CLIENT_ID = "719302024935-25psog12r9dd0facogtph49v6o48eh4h.apps.googleusercontent.com";

let googleToken = "";

function setLoggedIn(token, email) {
  googleToken = token;

  document.getElementById("login-state").textContent = email + " 으로 로그인했습니다.";
  document.getElementById("google-btn").hidden = true;
  document.getElementById("google-logout").hidden = false;
  document.getElementById("my-nickname").closest(".login-nick").hidden = false;

  document.querySelectorAll(".comment-form").forEach((f) => { f.hidden = false; });
  document.querySelectorAll(".comment-login-note").forEach((p) => { p.hidden = true; });
}

function setLoggedOut() {
  googleToken = "";

  document.getElementById("login-state").textContent = "";
  document.getElementById("google-btn").hidden = false;
  document.getElementById("google-logout").hidden = true;
  document.getElementById("my-nickname").closest(".login-nick").hidden = true;

  document.querySelectorAll(".comment-form").forEach((f) => { f.hidden = true; });
  document.querySelectorAll(".comment-login-note").forEach((p) => { p.hidden = false; });
}

// 토큰 안에 담긴 이메일을 화면 표시용으로만 꺼냅니다.
// 진짜 검증은 서버에서 구글에 직접 물어봅니다.
function peekEmail(token) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(payload)))).email || "";
  } catch (err) {
    return "";
  }
}

function handleGoogleLogin(response) {
  setLoggedIn(response.credential, peekEmail(response.credential));
}

document.getElementById("google-logout").addEventListener("click", () => {
  if (window.google && google.accounts && google.accounts.id) {
    google.accounts.id.disableAutoSelect();
  }
  setLoggedOut();
});

// 닉네임은 다음에 또 쓰도록 기억해 둡니다.
const savedNick = localStorage.getItem("nickname");
if (savedNick) document.getElementById("my-nickname").value = savedNick;

document.getElementById("my-nickname").addEventListener("change", (event) => {
  localStorage.setItem("nickname", event.target.value.trim());
});

window.addEventListener("load", () => {
  if (!window.google || !google.accounts || !google.accounts.id) return;

  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleLogin,
    auto_select: true,
  });

  google.accounts.id.renderButton(document.getElementById("google-btn"), {
    theme: "filled_black",
    size: "large",
    text: "signin_with",
    locale: "ko",
  });
});

setLoggedOut();

document.querySelectorAll(".comments").forEach((box) => {
  box.querySelector(".comment-form").addEventListener("submit", (event) => {
    event.preventDefault();
    submitComment(box);
  });
});

function showLoadError() {
  document.getElementById("load-status").hidden = false;
  document.getElementById("expenses-body").innerHTML =
    '<tr><td colspan="3" class="empty">내역을 불러오지 못했습니다.</td></tr>';
  document.getElementById("donations-body").innerHTML =
    '<tr><td colspan="3" class="empty">내역을 불러오지 못했습니다.</td></tr>';
  document.getElementById("gallery").innerHTML =
    '<li class="gallery-empty">사진을 불러오지 못했습니다.</li>';
  lastPhotoKey = null;
}

async function loadLedger() {
  if (!CONFIG.ledgerEndpoint) {
    showLoadError();
    return;
  }
  try {
    const res = await fetch(CONFIG.ledgerEndpoint);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    renderSummary(data);
    renderExpenses(Array.isArray(data.expenses) ? data.expenses : []);
    renderDonations(Array.isArray(data.donations) ? data.donations : []);
    renderGallery(Array.isArray(data.photos) ? data.photos : []);
    renderComments(data.comments || {});
  } catch (err) {
    showLoadError();
  }
}

function showCopyFeedback(message) {
  const el = document.getElementById("copy-feedback");
  el.textContent = message;
  clearTimeout(showCopyFeedback.timer);
  showCopyFeedback.timer = setTimeout(() => { el.textContent = ""; }, 3000);
}

async function copyAccountNumber() {
  const number = document.getElementById("account-number").textContent.trim();
  try {
    await navigator.clipboard.writeText(number);
    showCopyFeedback("계좌번호를 복사했습니다.");
  } catch (err) {
    showCopyFeedback("복사하지 못했습니다. 직접 입력해 주세요.");
  }
}

document.getElementById("copy-account").addEventListener("click", copyAccountNumber);

// ============================================================
// 공유하기
// ============================================================

// navigator.share는 브라우저 기본 기능입니다.
// 모바일에서 누르면 카카오톡을 포함한 공유 목록이 뜹니다.
// 지원하지 않는 브라우저(주로 데스크톱)에서는 주소를 복사합니다.
async function share() {
  const note = document.getElementById("share-msg");
  const url = location.origin + location.pathname;

  try {
    if (navigator.share) {
      await navigator.share({
        title: "옥희 도치 후원",
        text: "솔가람고등학교 옥희와 도치를 도와주세요.",
        url: url,
      });
      return;
    }

    await navigator.clipboard.writeText(url);
    note.textContent = "주소를 복사했습니다.";
    clearTimeout(share.timer);
    share.timer = setTimeout(() => { note.textContent = ""; }, 3000);
  } catch (err) {
    // 사용자가 공유창을 닫은 경우도 여기로 옵니다. 조용히 넘어갑니다.
  }
}

document.getElementById("share").addEventListener("click", share);

loadLedger();

// ============================================================
// 자동 새로고침 (10초)
// ============================================================

const REFRESH_MS = 10000;
let refreshTimer = null;

function startRefresh() {
  if (refreshTimer) return;
  refreshTimer = setInterval(loadLedger, REFRESH_MS);
}

function stopRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = null;
}

// 탭이 안 보일 때는 멈춰서 쓸데없는 요청을 막습니다.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopRefresh();
  } else {
    loadLedger();
    startRefresh();
  }
});

startRefresh();
