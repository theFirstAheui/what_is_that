"use strict";
const { run } = require("./gmwonya");
const { compile } = require("./compiler");

const ex1 = `그거 뭐지\n그그거 뭐지\n그거,그그거 뭐냐`;
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
const echo = `그거 진짜뭐지\n아 그거 ~ 그,,그그 어 . 그그 , 그 있잖아\n그거 진짜뭐냐\n그,,그그그그 있잖아`;
const addone = `그거 뭐지\n그거 , 그 뭐냐`;
const mul = `그거 뭐지\n그그거 뭐지\n그거 . 그그거 뭐냐`;
const negmem = `그거 뭐더라 그,,그그
그거거 뭐더라 그그그그그그그
그거 뭐더라 그,,그그그
그거거 뭐더라 그그그그그그그그그
그그거 뭐더라 그,,그그그
그거 뭐더라 그,,그그
그거거 , 그그거거 뭐냐`;

const cases = [
  ["ex1 a", ex1, "3 5"], ["ex1 b", ex1, "-4\n10"],
  ...[1, 2, 3, 5, 8, 12, 20, 30].map((n) => [`ex2 fib(${n})`, ex2, String(n)]),
  ["ex3 sort", ex3, "5 5 2 8 1 9"],
  ["ex3 neg", ex3, "6\n3 -1 3 0 -5 2"],
  ["echo ascii", echo, "Hello"], ["echo 한글", echo, "안녕 그뭐냐"], ["echo emoji", echo, "x🌟y"],
  ["i32 add", addone, "2147483647"], ["i32 mul", mul, "100000 100000"],
  ["negmem", negmem, ""],
];

let pass = 0, fail = 0;
for (const [name, src, input] of cases) {
  const a = run(src, input).output;
  const b = compile(src).run(input).output;
  const ok = a === b;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`   인터프리터: ${JSON.stringify(a)}\n   컴파일러:   ${JSON.stringify(b)}`);
  ok ? pass++ : fail++;
}

// 한도 옵션 동치성: 메모리 한도 초과 동작이 같은지
function caps(name, src, input, opts) {
  let ra, rb;
  try { ra = "OK:" + run(src, input, opts).output; } catch (e) { ra = "ERR:" + e.message; }
  try { rb = "OK:" + compile(src).run(input, opts).output; } catch (e) { rb = "ERR:" + e.message; }
  const ok = ra === rb;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${ra})`);
  ok ? pass++ : fail++;
}
const bigaddr = `그거 뭐더라 그그그그그그그그그그 . 그그그그그그그그그그 . 그그그그그그그그그그\n그거거 뭐더라 그그그그그\n그거거 뭐냐`;
caps("cap 초과 동치", bigaddr, "", { memHalfCap: 100, initHalf: 8 });
caps("cap 내 동치", bigaddr, "", { memHalfCap: 5000, initHalf: 8 });

console.log(`\n${pass} passed, ${fail} failed`);

// ── 벤치마크: 버블정렬 큰 입력 ─────────────────────────────
function randInput(n) {
  const xs = Array.from({ length: n }, () => Math.floor(Math.random() * 1000));
  return n + " " + xs.join(" ");
}
const N = 120;
const inp = randInput(N);
const expected = (() => {
  const xs = inp.trim().split(/\s+/).slice(1).map(Number).sort((a, b) => a - b);
  return xs.join(" ") + " ";
})();

const t0 = process.hrtime.bigint();
const ri = run(ex3, inp).output;
const t1 = process.hrtime.bigint();
const prog = compile(ex3);              // 컴파일 시간 별도
const t2 = process.hrtime.bigint();
const rc = prog.run(inp).output;
const t3 = process.hrtime.bigint();

const ms = (a, b) => Number(b - a) / 1e6;
console.log(`\n벤치마크: 버블정렬 ${N}개`);
console.log(`  결과 일치: ${ri === rc && rc === expected}`);
console.log(`  인터프리터 실행: ${ms(t0, t1).toFixed(1)} ms`);
console.log(`  컴파일:          ${ms(t1, t2).toFixed(2)} ms`);
console.log(`  컴파일 후 실행:  ${ms(t2, t3).toFixed(1)} ms`);
console.log(`  실행 속도 향상:  ${(ms(t0, t1) / ms(t2, t3)).toFixed(1)}x`);

process.exit(fail ? 1 : 0);
