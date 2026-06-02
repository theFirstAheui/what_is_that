#!/usr/bin/env node
"use strict";
const fs = require("fs");
const { run, GmwonyaError } = require("./gmwonya");
const { compile } = require("./compiler");

const args = process.argv.slice(2);
const useCompile = args.includes("--compile") || args.includes("-c");
const rest = args.filter((a) => a !== "--compile" && a !== "-c");
const [srcPath, inPath] = rest;
if (!srcPath) {
  console.error("사용법: node cli.js [--compile] <프로그램파일> [입력파일]");
  console.error("  --compile(-c): 트랜스파일러로 실행 (기본은 인터프리터)");
  console.error("  입력파일을 안 주면 표준입력(stdin)을 사용합니다.");
  process.exit(2);
}

const source = fs.readFileSync(srcPath, "utf8");
let input = "";
if (inPath) {
  input = fs.readFileSync(inPath, "utf8");
} else {
  try { input = fs.readFileSync(0, "utf8"); } catch { input = ""; } // stdin
}

try {
  const output = useCompile
    ? compile(source).run(input).output
    : run(source, input).output;
  process.stdout.write(output);
} catch (e) {
  if (e instanceof GmwonyaError) {
    console.error(`[그뭐냐 오류] ${e.message}`);
    process.exit(1);
  }
  throw e;
}
