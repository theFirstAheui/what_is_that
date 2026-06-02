"use strict";
/*
 * 그뭐냐 (Geu-Mwonya) — 난해 프로그래밍 언어 인터프리터 코어
 * ---------------------------------------------------------
 * 설계 메모
 *  - 메모리: 정수 1개씩 담는 칸. 음수/0/양수 인덱스 모두 허용. 첫 접근 시 0.
 *  - 항(term): 그* 거*
 *        거 0개 -> 리터럴 (그 개수)
 *        거 k개 -> 주소 = 그 개수에서 (k-1)번 역참조한 칸
 *                  (rvalue=그 칸의 값, lvalue=그 칸의 주소)
 *  - 연산: 중위, 좌결합. 우선순위 = 괄호 > 곱셈류 > 덧셈류 > 비교
 *        , 덧셈   ,, 뺄셈   . 곱셈   .. 몫(floor)   ... 나머지(floor)
 *        ; 큼(>)  ;; 크거나같음(>=)   ~ 같음(==)     아 ( ... 어 )
 *        비교 결과는 1/0
 *  - 문장(동사):
 *        <lval> 뭐지            정수 입력 -> 칸에 저장
 *        <lval> 진짜뭐지         문자 1개 입력 -> 코드포인트 저장 (EOF=-1)
 *        <expr> 뭐냐            정수 출력
 *        <expr> 진짜뭐냐         코드포인트 -> 유니코드 문자 출력
 *        <lval> 뭐더라 <expr>    대입
 *        <expr> 있잖아           상대 점프 (PC += expr; expr=1이면 다음 줄)
 *  - 줄 번호는 빈 줄 포함. 코드 범위 밖으로 점프하면 정상 종료.
 *  - 입력 스트림(단일 채널):
 *        뭐지     앞쪽 공백/개행 건너뛰고 [-]숫자 읽기(scanf식, 구분자는 안 먹음). EOF=0
 *        진짜뭐지  건너뛰기 없이 다음 1글자(코드포인트). EOF=-1
 */

class GmwonyaError extends Error {
  constructor(message, lineNo) {
    super(lineNo != null ? `${lineNo}번째 줄: ${message}` : message);
    this.name = "GmwonyaError";
    this.lineNo = lineNo;
  }
}

// 모든 값은 int32(2의 보수). |0 은 ToInt32, 곱셈은 Math.imul로 래핑.
const I32 = (x) => x | 0;

// 동사 키워드 (긴 것부터 매칭)
const KEYWORDS = [
  ["진짜뭐지", "jjinjja_mwoji"],
  ["진짜뭐냐", "jjinjja_mwonya"],
  ["뭐더라", "mwodeora"],
  ["있잖아", "itjanha"],
  ["뭐지", "mwoji"],
  ["뭐냐", "mwonya"],
];

function startsWithAt(chars, i, word) {
  const w = Array.from(word);
  if (i + w.length > chars.length) return false;
  for (let k = 0; k < w.length; k++) if (chars[i + k] !== w[k]) return false;
  return true;
}

// ── 토크나이저 ──────────────────────────────────────────────
function tokenizeLine(line, lineNo) {
  const chars = Array.from(line); // 코드포인트 단위
  const toks = [];
  let i = 0;
  const n = chars.length;

  while (i < n) {
    const c = chars[i];
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }

    // 키워드
    let matched = false;
    for (const [word, name] of KEYWORDS) {
      if (startsWithAt(chars, i, word)) {
        toks.push({ t: "verb", name });
        i += Array.from(word).length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // 항: 그* 거*
    if (c === "그" || c === "거") {
      let g = 0, geo = 0;
      while (i < n && chars[i] === "그") { g++; i++; }
      while (i < n && chars[i] === "거") { geo++; i++; }
      toks.push({ t: "term", g, geo });
      continue;
    }

    // 괄호
    if (c === "아") { toks.push({ t: "lparen" }); i++; continue; }
    if (c === "어") { toks.push({ t: "rparen" }); i++; continue; }

    // 연산자 (maximal munch)
    if (c === ",") {
      let k = 0; while (i < n && chars[i] === ",") { k++; i++; }
      if (k === 1) toks.push({ t: "op", op: "plus" });
      else if (k === 2) toks.push({ t: "op", op: "minus" });
      else throw new GmwonyaError(`',' ${k}개는 정의되지 않은 연산자`, lineNo);
      continue;
    }
    if (c === ".") {
      let k = 0; while (i < n && chars[i] === ".") { k++; i++; }
      if (k === 1) toks.push({ t: "op", op: "mul" });
      else if (k === 2) toks.push({ t: "op", op: "idiv" });
      else if (k === 3) toks.push({ t: "op", op: "mod" });
      else throw new GmwonyaError(`'.' ${k}개는 정의되지 않은 연산자`, lineNo);
      continue;
    }
    if (c === ";") {
      let k = 0; while (i < n && chars[i] === ";") { k++; i++; }
      if (k === 1) toks.push({ t: "op", op: "gt" });
      else if (k === 2) toks.push({ t: "op", op: "ge" });
      else throw new GmwonyaError(`';' ${k}개는 정의되지 않은 연산자`, lineNo);
      continue;
    }
    if (c === "~") { toks.push({ t: "op", op: "eq" }); i++; continue; }

    throw new GmwonyaError(`알 수 없는 문자 '${c}'`, lineNo);
  }
  return toks;
}

// ── 파서 ────────────────────────────────────────────────────
// 식 파싱(재귀 하강). 토큰 배열 전체를 소비해야 함.
function parseExpr(tokens, lineNo) {
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = () => tokens[pos++];

  function parsePrim() {
    const t = peek();
    if (!t) throw new GmwonyaError("식이 비어 있음", lineNo);
    if (t.t === "lparen") {
      eat();
      const e = parseCmp();
      if (!peek() || peek().t !== "rparen")
        throw new GmwonyaError("닫는 괄호 '어'가 없음", lineNo);
      eat();
      return e;
    }
    if (t.t === "term") { eat(); return { k: "term", g: t.g, geo: t.geo }; }
    if (t.t === "rparen") throw new GmwonyaError("짝 없는 '어'", lineNo);
    throw new GmwonyaError("식에서 예상치 못한 토큰", lineNo);
  }
  function binLevel(next, ops) {
    return () => {
      let l = next();
      while (peek() && peek().t === "op" && ops.includes(peek().op)) {
        const op = eat().op;
        l = { k: "bin", op, l, r: next() };
      }
      return l;
    };
  }
  const parseMul = binLevel(parsePrim, ["mul", "idiv", "mod"]);
  const parseAdd = binLevel(parseMul, ["plus", "minus"]);
  const parseCmp = binLevel(parseAdd, ["gt", "ge", "eq"]);

  const e = parseCmp();
  if (pos !== tokens.length)
    throw new GmwonyaError("식 뒤에 남은 토큰이 있음", lineNo);
  return e;
}

// lvalue(대입/입력 대상)는 단일 항이며 거 >= 1 이어야 함.
function parseLValue(tokens, lineNo) {
  if (tokens.length !== 1 || tokens[0].t !== "term")
    throw new GmwonyaError("대상은 메모리 항 하나여야 함", lineNo);
  const { g, geo } = tokens[0];
  if (geo < 1)
    throw new GmwonyaError("리터럴에는 저장할 수 없음 (거가 필요)", lineNo);
  return { g, geo };
}

function parseLine(rawLine, lineNo) {
  const toks = tokenizeLine(rawLine, lineNo);
  if (toks.length === 0) return null; // 빈 줄 (PC는 1 증가)

  const verbIdx = toks.findIndex((t) => t.t === "verb");
  if (verbIdx === -1)
    throw new GmwonyaError("동사(뭐지/뭐냐/뭐더라/있잖아/진짜뭐지/진짜뭐냐)가 없음", lineNo);
  const verb = toks[verbIdx].name;
  const left = toks.slice(0, verbIdx);
  const right = toks.slice(verbIdx + 1);

  switch (verb) {
    case "mwodeora": {
      const target = parseLValue(left, lineNo);
      const expr = parseExpr(right, lineNo);
      return { k: "assign", target, expr, lineNo };
    }
    case "mwoji": {
      if (right.length) throw new GmwonyaError("'뭐지' 뒤에는 토큰이 없어야 함", lineNo);
      return { k: "readint", target: parseLValue(left, lineNo), lineNo };
    }
    case "jjinjja_mwoji": {
      if (right.length) throw new GmwonyaError("'진짜뭐지' 뒤에는 토큰이 없어야 함", lineNo);
      return { k: "readchar", target: parseLValue(left, lineNo), lineNo };
    }
    case "mwonya": {
      if (right.length) throw new GmwonyaError("'뭐냐' 뒤에는 토큰이 없어야 함", lineNo);
      return { k: "printint", expr: parseExpr(left, lineNo), lineNo };
    }
    case "jjinjja_mwonya": {
      if (right.length) throw new GmwonyaError("'진짜뭐냐' 뒤에는 토큰이 없어야 함", lineNo);
      return { k: "printchar", expr: parseExpr(left, lineNo), lineNo };
    }
    case "itjanha": {
      if (right.length) throw new GmwonyaError("'있잖아' 뒤에는 토큰이 없어야 함", lineNo);
      return { k: "jump", expr: parseExpr(left, lineNo), lineNo };
    }
    default:
      throw new GmwonyaError(`알 수 없는 동사 ${verb}`, lineNo);
  }
}

class Program {
  constructor(source) {
    this.source = source;
    this.lines = source.split("\n");
    this.stmts = this.lines.map((ln, idx) => parseLine(ln, idx + 1));
  }
}

// ── 메모리 (0 중심 대칭 Int32Array, 인터프리터/컴파일러 공용) ──
class Memory {
  constructor(opts = {}) {
    this.halfCap = opts.memHalfCap ?? (1 << 22); // 한쪽 최대 주소 (기본 ±4,194,304)
    this.half = Math.min(opts.initHalf ?? 256, this.halfCap);
    this.cells = new Int32Array(2 * this.half + 1);
    this.line = null; // 오류 메시지용 현재 줄
  }
  _ensure(addr) {
    const a = addr < 0 ? -addr : addr;
    if (a <= this.half) return;
    if (a > this.halfCap)
      throw new GmwonyaError(`메모리 한도 초과: 주소 ${addr} (한도 ±${this.halfCap})`, this.line);
    let nh = this.half;
    while (nh < a) nh = Math.min(nh * 2, this.halfCap);
    const next = new Int32Array(2 * nh + 1);
    next.set(this.cells, nh - this.half); // 0 중심 유지하며 재배치 (양/음 대칭 확장)
    this.cells = next;
    this.half = nh;
  }
  get(addr) {
    const a = addr < 0 ? -addr : addr;
    if (a <= this.half) return this.cells[addr + this.half];
    if (a > this.halfCap)
      throw new GmwonyaError(`메모리 한도 초과: 주소 ${addr} (한도 ±${this.halfCap})`, this.line);
    return 0; // 한도 내 미확장 영역은 0 (읽기만으로는 확장하지 않음)
  }
  set(addr, val) {
    this._ensure(addr);
    this.cells[addr + this.half] = val; // Int32Array가 int32로 자동 절단
  }
}

// ── 가상 머신 (step 단위 실행) ──────────────────────────────
class Machine {
  constructor(program, inputString = "", opts = {}) {
    this.prog = program;
    this.pc = 0;               // 0-기반 줄 인덱스
    this.input = Array.from(inputString); // 코드포인트 배열
    this.ip = 0;               // 입력 커서
    this.output = "";
    this.halted = false;
    this.steps = 0;
    this.mem = new Memory(opts); // 0 중심 대칭 메모리
  }

  memGet(addr) { return this.mem.get(addr); }
  memSet(addr, val) { this.mem.set(addr, val); }

  // 항의 최종 주소(lvalue). geo>=1 전제.
  termAddr(node) {
    let addr = node.g;
    for (let d = 1; d < node.geo; d++) addr = this.memGet(addr);
    return addr;
  }
  // 항의 값(rvalue)
  termVal(node) {
    if (node.geo === 0) return node.g; // 리터럴
    return this.memGet(this.termAddr(node));
  }

  evalNode(n) {
    if (n.k === "term") return this.termVal(n);
    const a = this.evalNode(n.l);
    const b = this.evalNode(n.r);
    switch (n.op) {
      case "plus": return I32(a + b);
      case "minus": return I32(a - b);
      case "mul": return Math.imul(a, b); // int32 곱셈 래핑
      case "idiv":
        if (b === 0) throw new GmwonyaError("0으로 나눔(몫)", this._line);
        return I32(Math.floor(a / b)); // INT_MIN/-1 오버플로도 래핑
      case "mod":
        if (b === 0) throw new GmwonyaError("0으로 나눔(나머지)", this._line);
        return I32(((a % b) + b) % b); // floor 기준
      case "gt": return a > b ? 1 : 0;
      case "ge": return a >= b ? 1 : 0;
      case "eq": return a === b ? 1 : 0;
      default: throw new GmwonyaError(`알 수 없는 연산자 ${n.op}`, this._line);
    }
  }

  _isWs(ch) { return ch === " " || ch === "\t" || ch === "\n" || ch === "\r"; }

  nextInt() {
    const a = this.input;
    while (this.ip < a.length && this._isWs(a[this.ip])) this.ip++;
    if (this.ip >= a.length) return 0; // EOF
    let s = "";
    if (a[this.ip] === "-") { s += "-"; this.ip++; }
    let started = false;
    while (this.ip < a.length && a[this.ip] >= "0" && a[this.ip] <= "9") {
      s += a[this.ip]; this.ip++; started = true;
    }
    return started ? I32(parseInt(s, 10)) : 0;
  }

  nextChar() {
    if (this.ip >= this.input.length) return -1; // EOF
    return this.input[this.ip++].codePointAt(0);
  }

  // 한 문장 실행. 종료/오류는 halted/throw로.
  step() {
    if (this.halted) return;
    if (this.pc < 0 || this.pc >= this.prog.stmts.length) { this.halted = true; return; }
    const stmt = this.prog.stmts[this.pc];
    this.steps++;

    if (stmt === null) { this.pc++; this._afterPc(); return; }
    this._line = stmt.lineNo;
    this.mem.line = stmt.lineNo;

    switch (stmt.k) {
      case "assign":
        this.memSet(this.termAddr(stmt.target), this.evalNode(stmt.expr));
        this.pc++; break;
      case "readint":
        this.memSet(this.termAddr(stmt.target), this.nextInt());
        this.pc++; break;
      case "readchar":
        this.memSet(this.termAddr(stmt.target), this.nextChar());
        this.pc++; break;
      case "printint":
        this.output += String(this.evalNode(stmt.expr));
        this.pc++; break;
      case "printchar": {
        const cp = this.evalNode(stmt.expr);
        if (cp < 0 || cp > 0x10ffff)
          throw new GmwonyaError(`유효하지 않은 코드포인트 ${cp}`, stmt.lineNo);
        this.output += String.fromCodePoint(cp);
        this.pc++; break;
      }
      case "jump":
        this.pc += this.evalNode(stmt.expr);
        break;
      default:
        throw new GmwonyaError(`알 수 없는 문장 ${stmt.k}`, stmt.lineNo);
    }
    this._afterPc();
  }

  _afterPc() {
    if (this.pc < 0 || this.pc >= this.prog.stmts.length) this.halted = true;
  }

  run(maxSteps = 10_000_000) {
    while (!this.halted) {
      if (this.steps >= maxSteps)
        throw new GmwonyaError(`실행 스텝 한도(${maxSteps}) 초과 — 무한 루프 의심`);
      this.step();
    }
    return this.output;
  }
}

function run(source, input = "", opts = {}) {
  const prog = new Program(source);
  const m = new Machine(prog, input, opts);
  m.run(opts.maxSteps);
  return { output: m.output, machine: m };
}

module.exports = {
  GmwonyaError, tokenizeLine, parseExpr, parseLine, Program, Memory, Machine, run, I32,
};
