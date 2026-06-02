"use strict";
/*
 * 그뭐냐 기본 트랙 트랜스파일러
 * -----------------------------
 * 프로그램을 하나의 JS 함수로 컴파일한다. 구조:
 *
 *   while (true) {
 *     if (++steps > MAX) $.timeout();
 *     switch (pc) {
 *       case 0: <0번 줄>; break;
 *       case 1: <1번 줄>; break;
 *       ...
 *       default: return;        // pc 범위 밖 = 정상 종료
 *     }
 *   }
 *
 * - 식은 확정된 int32 규칙으로 인라인:  +,- 는 |0 / * 는 Math.imul / 몫·나머지는 $.idiv,$.imod(0검사+floor)
 * - 점프는 classify.js 분류를 활용:
 *     const          -> pc = <리터럴 목표>            (직접 점프)
 *     branch+select  -> pc = cond ? T : F            (삼항 분기)
 *     branch/dynamic -> pc = (i + <오프셋식>) | 0     (일반 평가)
 * - 메모리는 인터프리터와 동일한 Memory 클래스를 공유 -> 의미 일치 보장.
 */
const { Program, Memory, GmwonyaError, I32 } = require("./gmwonya");
const { classifyJump } = require("./classify");

// 항의 주소(lvalue, geo>=1) -> JS 식
function addrJS(n) {
  let e = String(n.g);
  for (let d = 1; d < n.geo; d++) e = `$.get(${e})`;
  return e;
}
// 임의 식 -> JS 식 (값, int32)
function exprJS(n) {
  if (n.k === "term") return n.geo === 0 ? String(n.g) : `$.get(${addrJS(n)})`;
  const a = exprJS(n.l), b = exprJS(n.r);
  switch (n.op) {
    case "plus": return `((${a}+${b})|0)`;
    case "minus": return `((${a}-${b})|0)`;
    case "mul": return `Math.imul(${a},${b})`;
    case "idiv": return `$.idiv(${a},${b})`;
    case "mod": return `$.imod(${a},${b})`;
    case "gt": return `(${a}>${b}?1:0)`;
    case "ge": return `(${a}>=${b}?1:0)`;
    case "eq": return `(${a}===${b}?1:0)`;
  }
}

function stmtJS(stmt, i) {
  const next = i + 1;
  if (stmt === null) return `pc=${next};`;
  const ln = stmt.lineNo;
  switch (stmt.k) {
    case "assign":
      return `$.L=${ln};$.set(${addrJS(stmt.target)},${exprJS(stmt.expr)});pc=${next};`;
    case "readint":
      return `$.L=${ln};$.set(${addrJS(stmt.target)},$.nextInt());pc=${next};`;
    case "readchar":
      return `$.L=${ln};$.set(${addrJS(stmt.target)},$.nextChar());pc=${next};`;
    case "printint":
      return `$.L=${ln};$.out(''+(${exprJS(stmt.expr)}));pc=${next};`;
    case "printchar":
      return `$.L=${ln};$.outc(${exprJS(stmt.expr)});pc=${next};`;
    case "jump": {
      const c = classifyJump(stmt.expr);
      if (c.kind === "const") return `pc=${i + c.offset};`;
      if (c.kind === "branch" && c.select)
        return `$.L=${ln};pc=(${exprJS(c.select.cond)})?${i + c.select.ifTrue}:${i + c.select.ifFalse};`;
      // branch(점프테이블) 또는 dynamic: 오프셋 식을 평가
      return `$.L=${ln};pc=((${i})+(${exprJS(stmt.expr)}))|0;`;
    }
  }
}

function makeRuntime(input, opts) {
  const mem = new Memory(opts);
  const a = Array.from(input);
  let ip = 0, out = "";
  const isWs = (c) => c === " " || c === "\t" || c === "\n" || c === "\r";
  const $ = {
    L: null,
    maxSteps: opts.maxSteps ?? 10_000_000,
    mem,
    get(addr) { mem.line = $.L; return mem.get(addr); },
    set(addr, val) { mem.line = $.L; mem.set(addr, val); },
    nextInt() {
      while (ip < a.length && isWs(a[ip])) ip++;
      if (ip >= a.length) return 0;
      let s = "";
      if (a[ip] === "-") { s += "-"; ip++; }
      let started = false;
      while (ip < a.length && a[ip] >= "0" && a[ip] <= "9") { s += a[ip]; ip++; started = true; }
      return started ? I32(parseInt(s, 10)) : 0;
    },
    nextChar() { return ip >= a.length ? -1 : a[ip++].codePointAt(0); },
    out(s) { out += s; },
    outc(cp) {
      if (cp < 0 || cp > 0x10ffff) throw new GmwonyaError(`유효하지 않은 코드포인트 ${cp}`, $.L);
      out += String.fromCodePoint(cp);
    },
    idiv(x, y) { if (y === 0) throw new GmwonyaError("0으로 나눔(몫)", $.L); return I32(Math.floor(x / y)); },
    imod(x, y) { if (y === 0) throw new GmwonyaError("0으로 나눔(나머지)", $.L); return I32(((x % y) + y) % y); },
    timeout() { throw new GmwonyaError(`실행 스텝 한도(${$.maxSteps}) 초과 — 무한 루프 의심`); },
    getOutput() { return out; },
  };
  return $;
}

function compile(source) {
  const prog = new Program(source);
  const cases = prog.stmts.map((s, i) => `case ${i}:${stmtJS(s, i)}break;`).join("\n");
  const body =
    `let pc=0,steps=0;const M=$.maxSteps;\n` +
    `while(true){\n` +
    `if(++steps>M)$.timeout();\n` +
    `switch(pc){\n${cases}\ndefault:return;\n}\n}`;
  const fn = new Function("$", body);
  return {
    code: body,
    run(input = "", opts = {}) {
      const $ = makeRuntime(input, opts);
      fn($);
      return { output: $.getOutput(), runtime: $ };
    },
  };
}

module.exports = { compile, exprJS, addrJS, makeRuntime };
