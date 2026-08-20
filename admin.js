// 옥도단 후원 — 관리자 페이지
//
// 토큰은 sessionStorage에만 보관합니다. 탭을 닫으면 사라집니다.
// 실제 인증은 서버(Apps Script)에서 하며, 여기 검사는 오타/공격 입력을
// 서버까지 보내지 않고 먼저 걸러내기 위한 것입니다.

const CONFIG = {
  ledgerEndpoint: "https://script.google.com/macros/s/AKfycbzPcRxtHiSduSJUSHVbA45sGkInLf8mjmgz_XzAwASZEddf7IifiFY1N2IHr6bqyMUKug/exec",
};

// 토큰 허용 형식: 영숫자와 - _ 만, 32~64자.
// 따옴표·세미콜론·등호·꺾쇠는 애초에 통과할 수 없습니다.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

// 형식을 벗어난 입력 중 "명백한 공격 시도"를 구분하기 위한 패턴.
// 정상 관리자는 이런 문자를 토큰 칸에 넣을 일이 없습니다.
const ATTACK_PATTERN = /('|"|;|--|\/\*|<|>|=|\bOR\b|\bAND\b|\bUNION\b|\bSELECT\b|\bDROP\b|\bINSERT\b|\bDELETE\b)/i;

const MAX_PHOTO_PX = 1600;

let token = sessionStorage.getItem("adminToken") || "";

function el(id) {
  return document.getElementById(id);
}

function msg(id, text, kind) {
  const node = el(id);
  node.textContent = text;
  node.className = "form-msg" + (kind ? " form-msg-" + kind : "");
}

async function callApi(action, payload) {
  // Content-Type을 text/plain으로 보내면 CORS 사전 요청(preflight)이 생기지 않습니다.
  // Apps Script는 OPTIONS 요청을 처리하지 못하므로 이 방식이 필요합니다.
  const res = await fetch(CONFIG.ledgerEndpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(Object.assign({ action: action, token: token }, payload || {})),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

function errorText(code, retryAfter) {
  if (code === "locked") {
    const min = Math.ceil((retryAfter || 0) / 60);
    return "잠긴 상태입니다. 약 " + min + "분 후에 다시 시도하세요.";
  }
  if (code === "blocked") return "허용되지 않는 입력입니다. 접근이 차단되었습니다.";
  if (code === "bad_token") return "토큰이 올바르지 않습니다.";
  if (code === "bad_type") return "jpg, png, webp 이미지만 올릴 수 있습니다.";
  if (code === "too_large") return "사진 용량이 너무 큽니다.";
  return "처리하지 못했습니다.";
}

// ============================================================
// 로그인
// ============================================================

function showPanel() {
  el("gate").hidden = true;
  el("panel").hidden = false;
  el("entry-date").value = new Date().toISOString().slice(0, 10);
  loadPhotos();
}

el("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = el("token-input").value;

  if (!TOKEN_PATTERN.test(input)) {
    // 입력값은 화면에 절대 되비추지 않습니다.
    if (ATTACK_PATTERN.test(input)) {
      msg("login-msg", "허용되지 않는 문자가 포함되어 있습니다. 시도가 기록됩니다.", "bad");
      token = input;
      try { await callApi("login"); } catch (err) { /* 기록만 하고 무시 */ }
      token = "";
    } else {
      msg("login-msg", "토큰 형식이 올바르지 않습니다.", "bad");
    }
    return;
  }

  token = input;
  msg("login-msg", "확인 중입니다.");

  try {
    const data = await callApi("login");
    if (data.ok) {
      sessionStorage.setItem("adminToken", token);
      msg("login-msg", "");
      showPanel();
    } else {
      token = "";
      msg("login-msg", errorText(data.error, data.retryAfter), "bad");
    }
  } catch (err) {
    token = "";
    msg("login-msg", "서버에 연결하지 못했습니다.", "bad");
  }
});

el("logout").addEventListener("click", () => {
  sessionStorage.removeItem("adminToken");
  token = "";
  el("panel").hidden = true;
  el("gate").hidden = false;
  el("token-input").value = "";
  msg("login-msg", "로그아웃되었습니다.");
});

// ============================================================
// 장부 기록
// ============================================================

el("entry-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  msg("entry-msg", "저장 중입니다.");

  try {
    const data = await callApi("addEntry", {
      date: el("entry-date").value,
      type: el("entry-type").value,
      amount: Number(el("entry-amount").value),
      description: el("entry-desc").value,
      name: el("entry-name").value,
      isPublic: el("entry-public").checked,
    });

    if (data.ok) {
      msg("entry-msg", "기록했습니다.", "good");
      el("entry-amount").value = "";
      el("entry-desc").value = "";
      el("entry-name").value = "";
      el("entry-public").checked = false;
    } else {
      msg("entry-msg", errorText(data.error, data.retryAfter), "bad");
    }
  } catch (err) {
    msg("entry-msg", "서버에 연결하지 못했습니다.", "bad");
  }
});

// ============================================================
// 사진
// ============================================================

// 구형 모바일 브라우저에는 createImageBitmap이 없어 <img>로 대신 읽습니다.
function loadImage(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 읽지 못했습니다."));
    };
    image.src = url;
  });
}

// 캔버스로 다시 그리면 크기가 줄고 EXIF(촬영 위치 등)가 함께 사라집니다.
async function shrink(file) {
  const source = await loadImage(file);
  const sourceWidth = source.width || source.naturalWidth;
  const sourceHeight = source.height || source.naturalHeight;

  const scale = Math.min(1, MAX_PHOTO_PX / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(source, 0, 0, width, height);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// 결과 메시지는 화면 밖에 있으면 못 보므로 보이는 곳으로 끌어옵니다.
function showUploadMsg(text, kind) {
  msg("upload-msg", text, kind);
  el("upload-msg").scrollIntoView({ block: "center" });
}

el("upload-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const files = Array.prototype.slice.call(el("photo-file").files);
  if (!files.length) return;

  // 설명은 고른 사진 전체에 같이 붙습니다.
  const caption = el("photo-caption").value;
  const submit = el("upload-submit");

  submit.disabled = true;

  let done = 0;
  const failed = [];

  for (let i = 0; i < files.length; i++) {
    showUploadMsg("올리는 중입니다. (" + (i + 1) + "/" + files.length + ")");

    try {
      const blob = await shrink(files[i]);
      const base64 = await toBase64(blob);

      const data = await callApi("uploadPhoto", {
        mimeType: "image/jpeg",
        dataBase64: base64,
        caption: caption,
      });

      if (data.ok) {
        done++;
      } else {
        failed.push(files[i].name + " (" + errorText(data.error, data.retryAfter) + ")");
      }
    } catch (err) {
      failed.push(files[i].name);
    }
  }

  submit.disabled = false;

  // 성공하든 실패하든 파일 선택은 비웁니다. 같은 사진이 두 번 올라가는 걸 막습니다.
  el("photo-file").value = "";

  if (!failed.length) {
    el("photo-caption").value = "";
    showUploadMsg(done + "장 올렸습니다.", "good");
  } else {
    showUploadMsg(
      done + "장 올렸고 " + failed.length + "장 실패했습니다: " + failed.join(", "),
      "bad"
    );
  }

  loadPhotos();
});

async function loadPhotos() {
  const list = el("admin-gallery");

  try {
    const res = await fetch(CONFIG.ledgerEndpoint);
    const data = await res.json();
    const photos = Array.isArray(data.photos) ? data.photos : [];

    list.textContent = "";

    if (!photos.length) {
      const li = document.createElement("li");
      li.className = "gallery-empty";
      li.textContent = "올린 사진이 없습니다.";
      list.appendChild(li);
      return;
    }

    for (const photo of photos) {
      const li = document.createElement("li");

      const img = document.createElement("img");
      img.src = photo.url;
      img.alt = photo.caption || "사진";
      img.loading = "lazy";
      li.appendChild(img);

      if (photo.caption) {
        const cap = document.createElement("p");
        cap.className = "gallery-caption";
        cap.textContent = photo.caption;
        li.appendChild(cap);
      }

      const del = document.createElement("button");
      del.type = "button";
      del.className = "cta cta-quiet";
      del.textContent = "내리기";
      del.addEventListener("click", () => removePhoto(photo.id, del));
      li.appendChild(del);

      list.appendChild(li);
    }
  } catch (err) {
    list.innerHTML = '<li class="gallery-empty">사진을 불러오지 못했습니다.</li>';
  }
}

async function removePhoto(id, button) {
  if (!window.confirm("이 사진을 사이트에서 내릴까요?")) return;

  button.disabled = true;
  try {
    const data = await callApi("deletePhoto", { id: id });
    if (data.ok) {
      loadPhotos();
    } else {
      button.disabled = false;
      window.alert(errorText(data.error, data.retryAfter));
    }
  } catch (err) {
    button.disabled = false;
    window.alert("서버에 연결하지 못했습니다.");
  }
}

// 새로고침해도 로그인 유지
if (TOKEN_PATTERN.test(token)) {
  showPanel();
}
