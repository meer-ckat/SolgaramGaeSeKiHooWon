# 옥도단 후원

솔가람고등학교에서 지내는 옥희와 도치를 위한 학생 운영 후원 안내 페이지.

- 프론트엔드: GitHub Pages 정적 사이트 (HTML/CSS/JS, 빌드 없음)
- 장부: Google Sheets (관리자가 직접 기록)
- 공개 데이터: Google Apps Script가 읽기 전용 JSON으로 제공

이 사이트는 **결제를 처리하지 않습니다.** 방문자는 표시된 계좌로
토스 또는 은행 앱에서 직접 송금하고, 관리자가 입금을 확인해 시트에 기록합니다.

## 파일 구조

```
index.html              페이지
style.css               스타일
script.js               현황 로딩 + 계좌 복사 (CONFIG.ledgerEndpoint 설정 필요)
assets/solgaram-logo.jpg  학교 공식 로고 (직접 넣어야 함)
apps-script/Code.gs     Apps Script 소스 (시트에 붙여넣어 배포)
```

## 1. 학교 로고 넣기

공식 로고 파일을 `assets/solgaram-logo.jpg` 이름으로 넣습니다.
파일이 없으면 페이지에 "솔가람고등학교" 텍스트가 대신 표시됩니다.
비공식 사본을 임의로 내려받아 쓰지 마세요.

## 2. 계좌 정보 설정

`index.html`의 후원하기 섹션에서 수정:

- 은행: `<dd>OO은행</dd>`
- 계좌번호: `<dd id="account-number">000-0000-0000</dd>` — **id는 지우지 마세요** (복사 버튼이 사용)
- 예금주: `<dd>홍길동</dd>`

## 3. Google Sheet 만들기

1. 새 Google 스프레드시트 생성
2. 시트(탭) 이름을 `ledger`로 변경
3. 1행에 머리글 입력:

| date | type | amount | description | public |
|------|------|--------|-------------|--------|

열 의미:

- `date` — 날짜 (예: 2026-08-20)
- `type` — `donation`(입금) 또는 `expense`(지출)
- `amount` — 금액. 입금은 양수, 지출은 음수로 적는 걸 권장 (부호는 자동 처리됨)
- `description` — 내용
- `public` — `TRUE`면 해당 **지출** 행이 웹에 공개됨. 입금 행은 항상 비공개

예시:

```
2026-08-20 | donation |   5000 | 익명 후원   | FALSE
2026-08-20 | expense  | -52000 | 사료 20kg  | TRUE
```

## 4. Apps Script 만들기 & 배포

1. script.google.com에서 **새 프로젝트** 생성 (시트와 같은 계정으로)
2. 기본 코드를 지우고 `apps-script/Code.gs` 내용을 붙여넣기
3. 코드 상단 `SHEET_ID`에 시트 주소의 `/d/`와 `/edit` 사이 문자열 입력, 목표 금액은 `GOAL` 수정
4. **배포 → 새 배포 → 유형: 웹 앱**
   - 실행 계정: **나**
   - 액세스 권한: **모든 사용자**
5. 배포 후 나오는 웹 앱 URL(`https://script.google.com/macros/s/.../exec`)을 복사

시트 내용을 바꾸면 바로 반영됩니다. 단, **코드**를 수정한 경우에는
"배포 관리"에서 새 버전으로 다시 배포해야 합니다.

## 5. 엔드포인트 URL 연결

`script.js` 맨 위:

```js
const CONFIG = {
  ledgerEndpoint: "https://script.google.com/macros/s/.../exec",
};
```

## 6. 관리자 기록 방법

**입금(후원) 기록:** 계좌 입금을 확인한 뒤 시트에 행 추가 —
`date`, `type=donation`, `amount`(양수), `description`, `public=FALSE`.
description에는 "익명 후원"처럼 적으세요. **후원자 이름·연락처 등 개인정보는 어디에도 적지 마세요.**

**지출 기록:** `date`, `type=expense`, `amount`(음수 권장), `description`(예: 사료 20kg),
공개할 지출이면 `public=TRUE`.

## 7. GitHub Pages 배포

1. GitHub 저장소를 만들고 이 폴더 전체를 push
2. 저장소 → **Settings → Pages**
3. Source: **Deploy from a branch**, Branch: `main`, 폴더 `/ (root)`
4. 몇 분 뒤 `https://<계정명>.github.io/<저장소명>/` 에서 확인

모든 경로가 상대 경로라 프로젝트 사이트 하위 경로에서 그대로 동작합니다.

## 8. 관리자 페이지

사이트 오른쪽 위 `ADMIN` 을 누르면 `admin.html` 로 갑니다.
AdminToken 을 넣으면 장부 기록과 사진 올리기를 할 수 있습니다.

- 토큰은 Apps Script **스크립트 속성**의 `ADMIN_TOKEN` 에만 있습니다.
  코드에도, 사이트 파일에도, git 에도 넣지 마세요.
- 토큰은 로그인한 탭에만 잠깐 남고 탭을 닫으면 사라집니다.
- 토큰 칸은 영숫자와 `-` `_` 32~64자만 받습니다.
  따옴표·등호 같은 문자는 아예 통과하지 못하고, 공격으로 보이는 입력은
  즉시 차단되며 `security_log` 시트에 남습니다.
- 틀린 시도가 10분에 5번 쌓이면 15분간 잠깁니다.
  잠겼을 때는 Apps Script 편집기에서 `잠금해제` 함수를 실행하세요.

**사진**은 올리기 전에 브라우저에서 크기를 줄이며, 이 과정에서 촬영 위치(GPS)
정보가 사라집니다. 사진 파일은 드라이브의 "옥도단 사진첩" 폴더에 저장되고
`photos` 시트에 기록됩니다. "내리기"를 눌러도 기록과 파일은 남고
공개만 꺼집니다(드라이브 휴지통).

## 9. 코드를 고쳤는데 사이트에 반영이 안 될 때

Cloudflare 가 `.js` `.css` 파일을 4시간 캐시합니다. HTML 은 캐시하지 않습니다.
그래서 JS/CSS 를 고쳤으면 HTML 안의 버전 숫자를 함께 올려야 바로 반영됩니다.

```html
<link rel="stylesheet" href="style.css?v=2">
<script src="script.js?v=2"></script>
```

`v=2` 를 `v=3` 으로 바꾸는 식입니다. Apps Script 코드를 고친 경우에는
"배포 → 배포 관리 → 연필 → 버전: **새 버전** → 배포" 를 해야 반영됩니다.

## 10. 무엇이 공개되는가

엔드포인트가 반환하는 것 **전부**:

- 목표/모금/사용/잔액 합계 (숫자만)
- `public=TRUE`인 지출 행의 날짜·내용·금액
- 마지막 갱신 시각

후원자 이름, 개별 입금 내역, `public=FALSE` 행, 시트 ID는 절대 반환되지 않습니다.
**공개 필드(특히 지출 description)에 후원자 개인정보를 넣지 마세요 — 넣는 순간 전 세계에 공개됩니다.**
