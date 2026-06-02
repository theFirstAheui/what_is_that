"use strict";
/*
 * 그뭐냐 점프 분류기
 * ------------------
 * 각 `있잖아`(점프)의 목적지 오프셋 집합을 정적으로 구한다.
 *
 * 추상 도메인:  Const/FiniteSet(크기 ≤ K)  또는  Top(임의 int32)
 *   리터럴        -> {n}
 *   메모리 읽기    -> Top
 *   비교(~ ; ;;)   -> {0,1}   (피연산자 무관 — Top을 0/1로 세탁)
 *   산술          -> 데카르트 곱 통과(int32 규칙). Top 전파, K 초과 시 와이드닝.
 *   몫/나머지에서 제수 집합이 0을 포함 -> 보수적으로 Top
 *
 * 출력(점프당):
 *   {kind:"const",   offset}              목적지 1개 (정적 무조건 점프)
 *   {kind:"branch",  targets:[...offsets] 목적지 유한 다중 (정적 분기/점프테이블)
 *                    , select?}           2갈래 중 "단일 불리언의 1차식"이면 선택자 첨부
 *   {kind:"dynamic"}                      Top (계산된 goto)
 *
 * select = { cond:<비교AST>, ifTrue:offset, ifFalse:offset }
 *   -> 코드 생성에서  pc = cond ? line+ifTrue : line+ifFalse  로 깔끔히 환원.
 */
const { Program } = require("./gmwonya");

const K = 64;              // 유한 집합 와이드닝 한계
const HALT = -1;           // 프로그램 범위 밖 = 정상 종료 후속자
const CMP = ["gt", "ge", "eq"];
const I32 = (x) => x | 0;

const TOP = { top: true };
const fin = (set) => ({ top: false, set });

function op32(op, x, y) {
  switch (op) {
    case "plus": return I32(x + y);
    case "minus": return I32(x - y);
    case "mul": return Math.imul(x, y);
    case "idiv": return I32(Math.floor(x / y));
    case "mod": return I32(((x % y) + y) % y);
  }
}

// 추상 평가 -> TOP | {top:false, set:Set<number>}
function absEval(n) {
  if (n.k === "term") return n.geo === 0 ? fin(new Set([n.g])) : TOP;
  if (CMP.includes(n.op)) return fin(new Set([0, 1])); // 비교 세탁
  const a = absEval(n.l), b = absEval(n.r);
  if (a.top || b.top) return TOP;
  if ((n.op === "idiv" || n.op === "mod") && b.set.has(0)) return TOP; // 0 나눔 가능 -> 보수적
  const out = new Set();
  for (const x of a.set) for (const y of b.set) {
    out.add(op32(n.op, x, y));
    if (out.size > K) return TOP; // 와이드닝
  }
  return fin(out);
}

// "단일 불리언의 1차식" 인식: 비교가 정확히 1개이고 그 밖에 자유 메모리 읽기가 없으면
// 비교를 0/1로 치환해 양쪽 상수 오프셋을 얻는다.
function scan(n, comps, bare) {
  if (n.k === "term") { if (n.geo >= 1) bare.v = true; return; }
  if (CMP.includes(n.op)) { comps.push(n); return; } // 비교 안으로는 안 들어감(세탁됨)
  scan(n.l, comps, bare); scan(n.r, comps, bare);
}
function foldSub(n, B, val) { // B를 val(0/1)로 보고 상수 폴딩. 불가능하면 null.
  if (n === B) return val;
  if (n.k === "term") return n.geo === 0 ? n.g : null;
  const a = foldSub(n.l, B, val); if (a === null) return null;
  const b = foldSub(n.r, B, val); if (b === null) return null;
  if ((n.op === "idiv" || n.op === "mod") && b === 0) return null; // 트랩 -> 목적지 아님
  return op32(n.op, a, b);
}
function detectAffine(expr) {
  const comps = [], bare = { v: false };
  scan(expr, comps, bare);
  if (comps.length !== 1 || bare.v) return null;
  const B = comps[0];
  const f = foldSub(expr, B, 0), t = foldSub(expr, B, 1);
  if (f === null || t === null) return null;
  return { cond: B, ifFalse: f, ifTrue: t };
}

function classifyJump(expr) {
  const ae = absEval(expr);
  if (ae.top) return { kind: "dynamic" };
  const vals = [...ae.set].sort((a, b) => a - b);
  if (vals.length === 1) return { kind: "const", offset: vals[0] };
  const r = { kind: "branch", targets: vals };
  const aff = detectAffine(expr);
  if (aff && new Set([aff.ifTrue, aff.ifFalse]).size === vals.length)
    r.select = { cond: aff.cond, ifTrue: aff.ifTrue, ifFalse: aff.ifFalse };
  return r;
}

// 프로그램 전체: 점프 줄마다 분류 + 절대 후속자(범위 밖은 HALT) 산출
function classifyProgram(src) {
  const prog = new Program(src);
  const N = prog.stmts.length;
  const toAbs = (i, off) => { const t = i + off; return t < 0 || t >= N ? HALT : t; };
  const out = [];
  prog.stmts.forEach((s, i) => {
    if (!s || s.k !== "jump") return;
    const c = classifyJump(s.expr);
    let succ;
    if (c.kind === "const") succ = [toAbs(i, c.offset)];
    else if (c.kind === "branch") succ = [...new Set(c.targets.map((o) => toAbs(i, o)))];
    else succ = "ANY";
    out.push({ lineIdx: i, line: i + 1, ...c, succ });
  });
  return { N, jumps: out };
}

module.exports = { classifyJump, classifyProgram, absEval, detectAffine, K, HALT };

// ── 직접 실행 시 데모 ───────────────────────────────────────
if (require.main === module) {
  const ex2 = `그거 뭐지
그그그그거 뭐더라 그
그그그그그거 뭐더라 그
그그거 뭐더라 그그거,그
아 그그;;그그거 어 . 그그그 , 그 있잖아
그그그거 뭐더라 그그그그거
그그그그거 뭐더라 그그그그그거
그그그그그거 뭐더라 그그그거,그그그그거
아 그거;그그거 어 . 아 그,,그그그그그그그 어 , 그 있잖아
그그그그그거 뭐냐`;

  const ex3 = `그거 뭐지
그그거 뭐더라 그,,그
아 그그거 ;; 그거 어 . 그그그그 , 그 있잖아
그그그그그거 뭐더라 그그그그그그그그그그 , 그그거
그그그그그거거 뭐지
그그거 뭐더라 그그거 , 그
그,,그그그그그 있잖아
그그거 뭐더라 그,,그
아 그그거 ;; 아 그거 ,, 그 어 어 . 그그그그그그그그그그그그 , 그 있잖아
그그그거 뭐더라 그,,그
아 그그그거 ;; 아 아 그거 ,, 그 어 ,, 그그거 어 어 . 그그그그그그그그 , 그 있잖아
그그그그그거 뭐더라 그그그그그그그그그그 , 그그그거
그그그그그그거 뭐더라 아 그그그그그그그그그그 , 그 어 , 그그그거
아 아 그그그그그거거 ; 그그그그그그거거 어 ~ 그,,그 어 . 그그그 , 그 있잖아
그그그그거 뭐더라 그그그그그거거
그그그그그거거 뭐더라 그그그그그그거거
그그그그그그거거 뭐더라 그그그그거
그그그거 뭐더라 그그그거 , 그
그,,그그그그그그그그그 있잖아
그그거 뭐더라 그그거 , 그
그,,그그그그그그그그그그그그그 있잖아
그그거 뭐더라 그,,그
아 그그거 ;; 그거 어 . 그그그그그, 그 있잖아
그그그그그거 뭐더라 그그그그그그그그그그 , 그그거
그그그그그거거 뭐냐
그그그그 . 아 그그그그 , 그그그그 어 진짜뭐냐
그그거 뭐더라 그그거 , 그
그,,그그그그그그 있잖아`;

  // 인위적 예: (3-갈래 분기) 와 (진짜 동적 점프)
  const threeway = `그거 뭐지
그그거 뭐지
그그그거 뭐지
그그그그거 뭐지
아 그거 ; 그그거 어 , 아 그그그거 ; 그그그그거 어 있잖아`;
  const dynjump = `그거 뭐지
그거 있잖아`;

  const show = (name, src) => {
    console.log(`\n=== ${name} ===`);
    const { N, jumps } = classifyProgram(src);
    for (const j of jumps) {
      let s;
      if (j.kind === "const") s = `상수    → 줄 ${j.succ[0] === HALT ? "종료" : j.succ[0] + 1}`;
      else if (j.kind === "branch") {
        const tgt = j.succ.map((t) => (t === HALT ? "종료" : t + 1)).join(",");
        s = `${j.targets.length}-갈래 → 줄 {${tgt}}` + (j.select ? "  [선택자 인식]" : "  [점프테이블]");
      } else s = `동적(computed goto) → ANY`;
      console.log(`  줄 ${j.line}: ${s}`);
    }
  };
  show("예제2 피보나치", ex2);
  show("예제3 버블정렬", ex3);
  show("인위적 3-갈래", threeway);
  show("인위적 동적점프", dynjump);
}
