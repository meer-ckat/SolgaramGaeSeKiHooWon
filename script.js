// 옥도단 후원 — 현황 로딩 + 지출 내역 + 계좌 복사

const CONFIG = {
  // Apps Script 웹 앱 배포 URL을 여기에 붙여넣으세요. (README 참고)
  ledgerEndpoint: "",
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
  const percent = goal > 0 ? Math.round((received / goal) * 100) : 0;

  document.getElementById("received").textContent = won(received);
  document.getElementById("goal").textContent = won(goal);
  document.getElementById("spent").textContent = won(spent);
  document.getElementById("balance").textContent = won(balance);

  // 100% 초과 시 바는 100%에서 멈추고 실제 퍼센트는 텍스트로 표시
  document.getElementById("percent").textContent = "목표의 " + percent + "% 달성";
  document.getElementById("bar-fill").style.width = Math.min(percent, 100) + "%";
  document.getElementById("bar").setAttribute("aria-valuenow", Math.min(percent, 100));
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

function showLoadError() {
  document.getElementById("load-status").hidden = false;
  document.getElementById("expenses-body").innerHTML =
    '<tr><td colspan="3" class="empty">내역을 불러오지 못했습니다.</td></tr>';
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
