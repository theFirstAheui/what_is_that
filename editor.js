"use strict";

/* ── int32 헬퍼 ─────────────────────────────────────────────── */
const I32 = (x) => x | 0;

/* ── 토크나이저 ─────────────────────────────────────────────── */
function tokenizeLine(text) {
  const regex = /(#.*)|(그+)|(거+)|(진짜뭐지|진짜뭐냐|뭐더라|뭐지|뭐냐|있잖아)|(아|어)|(\.\.\.|\.\.|\.|,,|,|;;|;|~)/g;
  const tokens = [];
  let lastIdx = 0;
  text.replace(regex, (match, comm, num, geo, cmd, bracket, op, offset) => {
    if (offset > lastIdx) tokens.push({ type: "text", val: text.slice(lastIdx, offset) });
    if      (comm)    tokens.push({ type: "comment", val: comm });
    else if (num)     tokens.push({ type: "num",     val: num });
    else if (geo)     tokens.push({ type: "geo",     val: geo });
    else if (cmd)     tokens.push({ type: "cmd",     val: cmd });
    else if (bracket) tokens.push({ type: "bracket", val: bracket });
    else if (op)      tokens.push({ type: "op",      val: op });
    lastIdx = offset + match.length;
    return match;
  });
  if (lastIdx < text.length) tokens.push({ type: "text", val: text.slice(lastIdx) });
  return tokens;
}

const codeToks = (line) =>
  tokenizeLine(line).filter((t) => t.type !== "text" && t.type !== "comment");

const isWs = (c) => c === " " || c === "\t" || c === "\n" || c === "\r";

/* ── 인터프리터 ─────────────────────────────────────────────── */
class GmwonyaError extends Error {
  constructor(message, lineNo) {
    super(lineNo != null ? `${lineNo}번째 줄: ${message}` : message);
    this.lineNo = lineNo;
  }
}

class Interp {
  constructor(source, stdin = "") {
    this.lines  = source.split("\n");
    this.input  = Array.from(stdin);
    this.ip     = 0;
    this.pc     = 0;
    this.memory = Object.create(null);
    this.halted = false;
    this.steps  = 0;
  }

  memGet(addr) { const v = this.memory[addr]; return v === undefined ? 0 : v | 0; }
  memSet(addr, val) { this.memory[addr] = val | 0; }

  nextInt() {
    const a = this.input;
    while (this.ip < a.length && isWs(a[this.ip])) this.ip++;
    if (this.ip >= a.length) return 0;
    let s = "";
    if (a[this.ip] === "-") { s += "-"; this.ip++; }
    let started = false;
    while (this.ip < a.length && a[this.ip] >= "0" && a[this.ip] <= "9") {
      s += a[this.ip]; this.ip++; started = true;
    }
    return started ? I32(parseInt(s, 10)) : 0;
  }
  nextChar() {
    if (this.ip >= this.input.length) return -1;
    return this.input[this.ip++].codePointAt(0);
  }

  /* 수식 평가 — 우선순위: 괄호 > 곱셈류(. .. ...) > 덧셈류(, ,,) > 비교(~ ; ;;)
   * 괄호 확장: 아...어 결과에 뒤따르는 거+ → 그 횟수만큼 역참조 */
  evalTokens(toks) {
    if (!toks || toks.length === 0) return 0;
    let pos = 0;
    const peek    = () => toks[pos];
    const consume = () => toks[pos++];
    const self    = this;

    function parseAtom() {
      if (peek() && peek().type === "bracket" && peek().val === "어") return 0;
      const t = consume();
      if (!t) return 0;

      if (t.type === "bracket" && t.val === "아") {
        let res = parseExpr();
        if (peek() && peek().type === "bracket" && peek().val === "어") consume();
        else throw new GmwonyaError("닫는 괄호 '어'가 없음", self._line);
        while (peek() && peek().type === "geo") {
          const g = consume();
          for (let i = 0; i < g.val.length; i++) res = self.memGet(res);
        }
        return res;
      }

      if (t.type === "num") {
        let val = t.val.length;
        while (peek() && peek().type === "geo") {
          const g = consume();
          for (let i = 0; i < g.val.length; i++) val = self.memGet(val);
        }
        return val;
      }

      return 0;
    }

    function parseFactor() {
      let node = parseAtom();
      while (peek() && peek().type === "op" && [".", "..", "..."].includes(peek().val)) {
        const op = consume().val, r = parseAtom();
        if (op === ".") node = Math.imul(node, r);
        else if (op === "..") {
          if (r === 0) throw new GmwonyaError("0으로 나눔(몫)", self._line);
          node = I32(Math.floor(node / r));
        } else {
          if (r === 0) throw new GmwonyaError("0으로 나눔(나머지)", self._line);
          node = I32(((node % r) + r) % r);
        }
      }
      return node;
    }

    function parseTerm() {
      let node = parseFactor();
      while (peek() && peek().type === "op" && [",", ",,"].includes(peek().val)) {
        const op = consume().val, r = parseFactor();
        node = op === "," ? I32(node + r) : I32(node - r);
      }
      return node;
    }

    function parseExpr() {
      let node = parseTerm();
      while (peek() && peek().type === "op" && ["~", ";", ";;"].includes(peek().val)) {
        const op = consume().val, r = parseTerm();
        if      (op === "~")  node = node === r ? 1 : 0;
        else if (op === ";")  node = node > r   ? 1 : 0;
        else                  node = node >= r  ? 1 : 0;
      }
      return node;
    }

    return parseExpr();
  }

  /* lvalue 주소 해석 — 뒤쪽 geo 토큰들을 분리 후 (geo-1)번 역참조 */
  resolveAddr(tokens) {
    let geoCount = 0, i = tokens.length - 1;
    while (i >= 0 && tokens[i].type === "geo") { geoCount += tokens[i].val.length; i--; }
    const baseToks = tokens.slice(0, i + 1);
    if (geoCount < 1) throw new GmwonyaError("대상은 메모리 항이어야 함 (거가 필요)", this._line);
    let addr = baseToks.length === 0 ? 0 : this.evalTokens(baseToks);
    for (let j = 0; j < geoCount - 1; j++) addr = this.memGet(addr);
    return addr;
  }

  /* 한 줄(문장) 실행. 입출력 이벤트 배열 반환 */
  step() {
    if (this.halted) return [];
    if (this.pc < 0 || this.pc >= this.lines.length) { this.halted = true; return []; }
    this.steps++;
    const lineNo = this.pc + 1;
    this._line   = lineNo;

    const code   = this.lines[this.pc].split("#")[0];
    const toks   = codeToks(code);
    const cmdIdx = toks.findIndex((t) => t.type === "cmd");

    if (toks.length === 0 || cmdIdx === -1) {
      this.pc++; this._haltIfOob(); return [];
    }

    const cmd    = toks[cmdIdx].val;
    const left   = toks.slice(0, cmdIdx);
    const right  = toks.slice(cmdIdx + 1);
    const events = [];
    let jumped   = false;

    switch (cmd) {
      case "뭐더라":
        this.memSet(this.resolveAddr(left), this.evalTokens(right));
        break;
      case "뭐지": {
        const addr = this.resolveAddr(left);
        const val  = this.nextInt();
        this.memSet(addr, val);
        events.push({ e: "readint", addr, val });
        break;
      }
      case "진짜뭐지": {
        const addr = this.resolveAddr(left);
        const val  = this.nextChar();
        this.memSet(addr, val);
        events.push({ e: "readchar", addr, val });
        break;
      }
      case "뭐냐":
        events.push({ e: "out", s: String(this.evalTokens(left)) });
        break;
      case "진짜뭐냐": {
        const cp = this.evalTokens(left);
        if (cp < 0 || cp > 0x10ffff)
          throw new GmwonyaError(`유효하지 않은 코드포인트 ${cp}`, lineNo);
        events.push({ e: "outc", s: String.fromCodePoint(cp) });
        break;
      }
      case "있잖아":
        this.pc += this.evalTokens(left);
        jumped = true;
        break;
      default:
        throw new GmwonyaError(`알 수 없는 동사 ${cmd}`, lineNo);
    }

    if (!jumped) this.pc++;
    this._haltIfOob();
    return events;
  }

  _haltIfOob() {
    if (this.pc < 0 || this.pc >= this.lines.length) this.halted = true;
  }
}

/* ═══════════════════════════════════════════════════════════════
 *  UI 레이어
 * ═══════════════════════════════════════════════════════════════ */
const MAX_STEPS = 5_000_000;

const editorEl  = document.getElementById("editor");
const hlView    = document.getElementById("highlight-view");
const dbgView   = document.getElementById("debug-view");
const gutterEl  = document.getElementById("gutter");
const consoleEl = document.getElementById("console");
const memCont   = document.getElementById("mem-content");
const stdinEl   = document.getElementById("stdin");
const stdinSt   = document.getElementById("stdin-status");
const stepInfo  = document.getElementById("step-info");
const exSel     = document.getElementById("example-select");
const btnMode   = document.getElementById("btn-mode");
const btnStep   = document.getElementById("btn-step");
const btnRun    = document.getElementById("btn-run");
const btnStop   = document.getElementById("btn-stop");
const btnReset  = document.getElementById("btn-reset");
const statusTxt = document.getElementById("status-text");

let interp          = null;
let isRunMode       = false;
let isRunning       = false;
let currentOutSpan  = null;
let lastWrittenAddr = null;
let lineEls         = [];
let activeLineIdx   = -1;

/* ── 출력 헬퍼 ──────────────────────────────────────────── */
function printOut(msg) {
  if (!currentOutSpan) {
    currentOutSpan = document.createElement("span");
    currentOutSpan.className = "c-out";
    consoleEl.appendChild(currentOutSpan);
  }
  currentOutSpan.append(msg);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}
function log(msg, cls = "c-info") {
  currentOutSpan = null;
  const div = document.createElement("div");
  div.className = cls;
  div.innerText = msg;
  consoleEl.appendChild(div);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

/* ── HTML 이스케이프 ─────────────────────────────────────── */
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ── 하이라이트 렌더 ─────────────────────────────────────── */
function renderTokens(tokens) {
  let html = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // 그+거+ → 하나의 메모리 항 span
    if (t.type === "num" && tokens[i + 1] && tokens[i + 1].type === "geo") {
      const term = t.val + tokens[i + 1].val;
      html += `<span class="tok-mem" data-term="${esc(term)}">${esc(term)}</span>`;
      i++;
    } else if (t.type === "geo") {
      html += `<span class="tok-mem" data-term="${esc(t.val)}">${esc(t.val)}</span>`;
    } else if (t.type === "num") {
      html += `<span class="tok-num">${esc(t.val)}</span>`;
    } else {
      html += `<span class="tok-${t.type}">${esc(t.val)}</span>`;
    }
  }
  return html;
}

function updateHighlight() {
  const lines = editorEl.value.split("\n");
  hlView.innerHTML = lines
    .map((ln) => `<div class="line">${renderTokens(tokenizeLine(ln))} </div>`)
    .join("");
  updateGutter(lines.length, isRunMode && interp ? interp.pc : -1);
  syncScroll();
}

function syncScroll() {
  hlView.scrollTop  = editorEl.scrollTop;
  hlView.scrollLeft = editorEl.scrollLeft;
  gutterEl.scrollTop = editorEl.scrollTop;
}

/* ── 줄 번호 거터 ────────────────────────────────────────── */
function updateGutter(lineCount, activePc = -1) {
  let html = "";
  for (let i = 0; i < lineCount; i++) {
    html += `<div${i === activePc ? ' class="active-ln"' : ""}>${i + 1}</div>`;
  }
  gutterEl.innerHTML = html;
}

/* ── 디버그 뷰 ───────────────────────────────────────────── */
function buildDebugView() {
  const lines = editorEl.value.split("\n");
  dbgView.innerHTML = lines
    .map((ln, i) => `<div id="ln-${i}" class="line">${renderTokens(tokenizeLine(ln))}</div>`)
    .join("");
  lineEls = lines.map((_, i) => document.getElementById(`ln-${i}`));
  activeLineIdx = -1;
}

function setActiveLine(idx, scroll = false) {
  if (activeLineIdx >= 0 && lineEls[activeLineIdx])
    lineEls[activeLineIdx].classList.remove("active");
  if (idx >= 0 && idx < lineEls.length && lineEls[idx]) {
    lineEls[idx].classList.add("active");
    if (scroll) lineEls[idx].scrollIntoView({ behavior: "smooth", block: "center" });
  }
  activeLineIdx = idx;
  updateGutter(lineEls.length, idx);
  gutterEl.scrollTop = dbgView.scrollTop;
}

/* ── STDIN 커서 표시 ─────────────────────────────────────── */
function updateStdinStatus() {
  if (!interp) {
    const len = Array.from(stdinEl.value).length;
    stdinSt.innerHTML = `<span class="dim">대기 중</span> · 총 ${len}자`;
    return;
  }
  const arr = interp.input, ip = interp.ip;
  const ws = Math.max(0, ip - 12);
  const consumed = esc(arr.slice(ws, ip).join(""));
  const rest     = esc(arr.slice(ip, ip + 24).join(""));
  stdinSt.innerHTML =
    `${ws > 0 ? "…" : ""}<span class="dim">${consumed}</span>` +
    `<span class="caret">‸</span>${rest}${ip + 24 < arr.length ? "…" : ""}` +
    ` <span class="dim">(${ip}/${arr.length})</span>`;
}

/* ── 메모리 덤프 ─────────────────────────────────────────── */
function updateMemoryView() {
  if (!interp || Object.keys(interp.memory).length === 0) {
    memCont.innerHTML = `<div class="c-dim">(비어 있음)</div>`;
    return;
  }
  memCont.innerHTML = Object.keys(interp.memory)
    .map(Number)
    .sort((a, b) => a - b)
    .map((k) => {
      const v   = interp.memory[k];
      const chr = v >= 32 && v <= 126 ? ` <span class="mem-chr">('${String.fromCharCode(v)}')</span>` : "";
      const hot = k === lastWrittenAddr ? " mem-hot" : "";
      return `<div class="mem-row${hot}"><span class="mem-k">[${k}번]</span> ${v}${chr}</div>`;
    })
    .join("");
}

function updateStepInfo() {
  stepInfo.innerText = interp ? `스텝 ${interp.steps} · ${interp.pc + 1}줄` : "스텝 0";
}

/* ── 인터프리터 초기화 ───────────────────────────────────── */
function freshInterp() {
  interp          = new Interp(editorEl.value, stdinEl.value);
  lastWrittenAddr = null;
  currentOutSpan  = null;
  consoleEl.innerHTML = "";
  buildDebugView();
  setActiveLine(interp.pc, true);
  updateMemoryView();
  updateStdinStatus();
  updateStepInfo();
  log(">>> 실행 시작 — STDIN에서 입력을 읽습니다.", "c-dim");
}

/* ── 모드 전환 ───────────────────────────────────────────── */
function enterRunMode() {
  isRunMode = true;
  editorEl.style.display  = "none";
  hlView.style.display    = "none";
  dbgView.style.display   = "block";
  btnStep.style.display   = "inline-block";
  btnMode.innerText       = "✏️ 편집 모드";
  btnMode.classList.remove("primary");
  statusTxt.innerText     = "실행/디버그";
  stdinEl.readOnly        = true;
  stdinEl.classList.add("locked");
  freshInterp();
}

function exitRunMode() {
  isRunMode = false;
  editorEl.style.display  = "";
  hlView.style.display    = "";
  dbgView.style.display   = "none";
  btnStep.style.display   = "none";
  btnMode.innerText       = "⚙️ 실행 모드";
  btnMode.classList.add("primary");
  statusTxt.innerText     = "편집 중";
  stdinEl.readOnly        = false;
  stdinEl.classList.remove("locked");
  interp = null;
  updateStdinStatus();
  updateStepInfo();
  updateHighlight();
}

function toggleMode() {
  if (!isRunMode) enterRunMode(); else exitRunMode();
}

/* ── 한 스텝 실행 ────────────────────────────────────────── */
function takeStep(render = true) {
  if (!isRunMode) enterRunMode();
  else if (!interp || interp.halted) freshInterp();
  if (!interp) return false;

  let events;
  try {
    events = interp.step();
  } catch (err) {
    log(`\n[오류] ${err && err.message ? err.message : String(err)}`, "c-err");
    interp.halted = true;
    setActiveLine(-1);
    if (render) { updateMemoryView(); updateStdinStatus(); updateStepInfo(); }
    return false;
  }

  for (const ev of events) {
    if (ev.e === "out" || ev.e === "outc") {
      printOut(ev.s);
    } else if (ev.e === "readint") {
      lastWrittenAddr = ev.addr;
      log(`[입력→${ev.addr}번] ${ev.val}${interp.ip >= interp.input.length ? " (EOF=0)" : ""}`, "c-in");
    } else if (ev.e === "readchar") {
      lastWrittenAddr = ev.addr;
      const shown = ev.val === -1 ? "EOF(-1)" : `${ev.val} (${String.fromCodePoint(ev.val)})`;
      log(`[글자입력→${ev.addr}번] ${shown}`, "c-in");
    }
  }

  setActiveLine(interp.halted ? -1 : interp.pc, render);
  if (render) { updateMemoryView(); updateStdinStatus(); updateStepInfo(); }
  if (interp.halted) { log("\n>>> 프로그램 종료."); return false; }
  return true;
}

/* ── 전체 실행 ───────────────────────────────────────────── */
async function runAll() {
  const startFromEdit = !isRunMode;
  if (startFromEdit) enterRunMode();
  else if (!interp || interp.halted) freshInterp();
  if (isRunning) return;

  isRunning = true;
  btnRun.style.display  = "none";
  btnStop.style.display = "inline-block";
  btnStep.disabled      = true;

  let alive = true;
  while (isRunning && alive) {
    for (let i = 0; i < 4000 && isRunning; i++) {
      if (interp.steps >= MAX_STEPS) {
        log(`\n>>> 스텝 한도(${MAX_STEPS}) 초과 — 무한 루프 의심`, "c-err");
        isRunning = false; alive = false; break;
      }
      alive = takeStep(false);
      if (!alive) break;
    }
    if (interp) setActiveLine(interp.halted ? -1 : interp.pc, false);
    updateMemoryView();
    updateStdinStatus();
    updateStepInfo();
    await new Promise((r) => setTimeout(r, 0));
  }

  if (isRunning) stopRun(false);
  if (startFromEdit) {
    setTimeout(() => {
      if (isRunMode) exitRunMode();
      log(">> 편집 모드로 복귀", "c-dim");
    }, 400);
  }
}

function stopRun(forced = true) {
  isRunning             = false;
  btnRun.style.display  = "";
  btnStop.style.display = "none";
  btnStep.disabled      = false;
  if (forced) log("\n>>> 강제 중지됨", "c-err");
}

function resetAll() {
  stopRun(false);
  if (isRunMode) exitRunMode();
  interp          = null;
  currentOutSpan  = null;
  lastWrittenAddr = null;
  consoleEl.innerHTML = '<div class="c-dim"># 리셋됨</div>';
  updateMemoryView();
  updateStdinStatus();
  updateStepInfo();
  updateHighlight();
}

/* ── Ghost Hover: 동일 메모리 항 강조 ───────────────────── */
let currentHoverTerm = null;

editorEl.addEventListener("mousemove", (e) => {
  if (isRunMode) return;
  editorEl.style.pointerEvents = "none";
  hlView.style.pointerEvents   = "auto";
  const el = document.elementFromPoint(e.clientX, e.clientY);
  hlView.style.pointerEvents   = "none";
  editorEl.style.pointerEvents = "auto";
  if (el && el.classList.contains("tok-mem")) hoverMem(el.getAttribute("data-term"));
  else clearHover();
});
editorEl.addEventListener("mouseleave", clearHover);

function hoverMem(term) {
  if (currentHoverTerm === term) return;
  clearHover();
  currentHoverTerm = term;
  document.querySelectorAll(`.tok-mem[data-term="${CSS.escape(term)}"]`)
    .forEach((el) => el.classList.add("highlight"));
}
function clearHover() {
  if (currentHoverTerm === null) return;
  document.querySelectorAll(".tok-mem.highlight").forEach((el) => el.classList.remove("highlight"));
  currentHoverTerm = null;
}

/* ── 예제 ────────────────────────────────────────────────── */
const EXAMPLES = {
  sum: {
    label: "두 수의 합",
    stdin: "3 5",
    code:  ["그거 뭐지", "그그거 뭐지", "그거,그그거 뭐냐"].join("\n"),
  },
  fib: {
    label: "피보나치(n번째)",
    stdin: "20",
    code: [
      "그거 뭐지",
      "그그그그거 뭐더라 그",
      "그그그그그거 뭐더라 그",
      "그그거 뭐더라 그그거,그",
      "아 그그;;그그거 어 . 그그그 , 그 있잖아",
      "그그그거 뭐더라 그그그그거",
      "그그그그거 뭐더라 그그그그그거",
      "그그그그그거 뭐더라 그그그거,그그그그거",
      "아 그거;그그거 어 . 아 그,,그그그그그그그 어 , 그 있잖아",
      "그그그그그거 뭐냐",
    ].join("\n"),
  },
  sort: {
    label: "버블 정렬",
    stdin: "5 5 2 8 1 9",
    code: [
      "그거 뭐지",
      "그그거 뭐더라 그,,그",
      "아 그그거 ;; 그거 어 . 그그그그 , 그 있잖아",
      "그그그그그거 뭐더라 그그그그그그그그그그 , 그그거",
      "그그그그그거거 뭐지",
      "그그거 뭐더라 그그거 , 그",
      "그,,그그그그그 있잖아",
      "그그거 뭐더라 그,,그",
      "아 그그거 ;; 아 그거 ,, 그 어 어 . 그그그그그그그그그그그그 , 그 있잖아",
      "그그그거 뭐더라 그,,그",
      "아 그그그거 ;; 아 아 그거 ,, 그 어 ,, 그그거 어 어 . 그그그그그그그그 , 그 있잖아",
      "그그그그그거 뭐더라 그그그그그그그그그그 , 그그그거",
      "그그그그그그거 뭐더라 아 그그그그그그그그그그 , 그 어 , 그그그거",
      "아 아 그그그그그거거 ; 그그그그그그거거 어 ~ 그,,그 어 . 그그그 , 그 있잖아",
      "그그그그거 뭐더라 그그그그그거거",
      "그그그그그거거 뭐더라 그그그그그그거거",
      "그그그그그그거거 뭐더라 그그그그거",
      "그그그거 뭐더라 그그그거 , 그",
      "그,,그그그그그그그그그 있잖아",
      "그그거 뭐더라 그그거 , 그",
      "그,,그그그그그그그그그그그그그 있잖아",
      "그그거 뭐더라 그,,그",
      "아 그그거 ;; 그거 어 . 그그그그그, 그 있잖아",
      "그그그그그거 뭐더라 그그그그그그그그그그 , 그그거",
      "그그그그그거거 뭐냐",
      "그그그그 . 아 그그그그 , 그그그그 어 진짜뭐냐",
      "그그거 뭐더라 그그거 , 그",
      "그,,그그그그그그 있잖아",
    ].join("\n"),
  },
  echo: {
    label: "유니코드 에코",
    stdin: "안녕 그뭐냐 🌟",
    code: [
      "그거 진짜뭐지",
      "아 그거 ~ 그,,그그 어 . 그그 , 그 있잖아",
      "그거 진짜뭐냐",
      "그,,그그그그 있잖아",
    ].join("\n"),
  },
};

function loadExample() {
  const key = exSel.value;
  if (!key || !EXAMPLES[key]) return;
  if (isRunMode) exitRunMode();
  editorEl.value = EXAMPLES[key].code;
  stdinEl.value  = EXAMPLES[key].stdin;
  updateHighlight();
  updateStdinStatus();
  log(`# 예제: ${EXAMPLES[key].label}`, "c-dim");
  exSel.value = "";
}

/* ── 키보드 단축키 ───────────────────────────────────────── */
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    if (!isRunning) runAll();
  }
  if (e.key === "F8" && !isRunning) {
    e.preventDefault();
    takeStep(true);
  }
  if (e.key === "Escape" && isRunning) stopRun(true);
});

/* ── 이벤트 바인딩 ───────────────────────────────────────── */
editorEl.addEventListener("input",  updateHighlight);
editorEl.addEventListener("scroll", syncScroll);
stdinEl.addEventListener("input",   updateStdinStatus);
dbgView.addEventListener("scroll",  () => { gutterEl.scrollTop = dbgView.scrollTop; });

btnMode.addEventListener("click",  toggleMode);
btnStep.addEventListener("click",  () => takeStep(true));
btnRun.addEventListener("click",   runAll);
btnStop.addEventListener("click",  () => stopRun(true));
btnReset.addEventListener("click", resetAll);
exSel.addEventListener("change",   loadExample);

window.addEventListener("beforeunload", (e) => {
  if (editorEl.value.trim() !== "") { e.preventDefault(); e.returnValue = ""; }
});

/* ── 초기 상태 ───────────────────────────────────────────── */
editorEl.value = EXAMPLES.sum.code;
stdinEl.value  = EXAMPLES.sum.stdin;
updateHighlight();
updateStdinStatus();
updateStepInfo();
log("# 준비 완료 — 예제를 고르거나 코드 입력 후 ▶ 실행 (Ctrl+Enter)");
