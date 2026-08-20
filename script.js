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

function renderGallery(photos) {
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
    li.appendChild(img);

    if (photo.caption) {
      const cap = document.createElement("p");
      cap.className = "gallery-caption";
      cap.textContent = photo.caption;
      li.appendChild(cap);
    }

    list.appendChild(li);
  }
}

function showLoadError() {
  document.getElementById("load-status").hidden = false;
  document.getElementById("expenses-body").innerHTML =
    '<tr><td colspan="3" class="empty">내역을 불러오지 못했습니다.</td></tr>';
  document.getElementById("donations-body").innerHTML =
    '<tr><td colspan="3" class="empty">내역을 불러오지 못했습니다.</td></tr>';
  document.getElementById("gallery").innerHTML =
    '<li class="gallery-empty">사진을 불러오지 못했습니다.</li>';
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

loadLedger();
