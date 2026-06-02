"use strict";
const { run } = require("./gmwonya");

const ex1 = `그거 뭐지
그그거 뭐지
그거,그그거 뭐냐`;

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

// 유니코드 echo: 입력 끝(-1)까지 한 글자씩 그대로 출력
const echo = `그거 진짜뭐지
아 그거 ~ 그,,그그 어 . 그그 , 그 있잖아
그거 진짜뭐냐
그,,그그그그 있잖아`;

function jsFib(n) { let a = 1, b = 1; if (n <= 2) return 1; for (let i = 3; i <= n; i++) { [a, b] = [b, a + b]; } return b; }

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`   기대: ${JSON.stringify(want)}\n   실제: ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}

// 예제 1: 두 수의 합
check("ex1  3 5 -> 8", run(ex1, "3 5").output, "8");
check("ex1  -4 10 -> 6", run(ex1, "-4\n10").output, "6");

// 예제 2: n번째 피보나치
for (const n of [1, 2, 3, 4, 5, 6, 7, 10, 15, 20]) {
  check(`ex2  fib(${n})`, run(ex2, String(n)).output, String(jsFib(n)));
}

// 예제 3: 버블 정렬 (입력: 개수 n, 이어서 n개)
check("ex3  sort 5개", run(ex3, "5 5 2 8 1 9").output, "1 2 5 8 9 ");
check("ex3  sort 6개 음수", run(ex3, "6\n3 -1 3 0 -5 2").output, "-5 -1 0 2 3 3 ");
check("ex3  sort 1개", run(ex3, "1 42").output, "42 ");

// echo: ASCII + 한글 + 이모지
check("echo ASCII", run(echo, "Hello").output, "Hello");
check("echo 한글", run(echo, "안녕 그뭐냐").output, "안녕 그뭐냐");
check("echo 이모지", run(echo, "héllo🌟ok").output, "héllo🌟ok");

// int32 래핑: 2147483647 + 1 -> -2147483648
const addone = `그거 뭐지\n그거 , 그 뭐냐`;
check("i32 덧셈 오버플로", run(addone, "2147483647").output, "-2147483648");

// int32 곱셈 래핑(Math.imul): 100000 * 100000 -> 1410065408
const mul = `그거 뭐지\n그그거 뭐지\n그거 . 그그거 뭐냐`;
check("i32 곱셈 래핑", run(mul, "100000 100000").output, String(Math.imul(100000, 100000)));

// 음수 방향 메모리(리스트 관용구): mem[-1]=7, mem[-2]=9, 합 출력
// mem[1],mem[2]를 포인터로 -1,-2에 두고 그거거/그그거거로 간접 접근
const negmem = `그거 뭐더라 그,,그그
그거거 뭐더라 그그그그그그그
그거 뭐더라 그,,그그그
그거거 뭐더라 그그그그그그그그그
그그거 뭐더라 그,,그그그
그거 뭐더라 그,,그그
그거거 , 그그거거 뭐냐`;
check("음수 대칭 메모리", run(negmem, "").output, "16");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
