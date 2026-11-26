import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./Experts/UltraLOB_Bridge_EA.mq5", import.meta.url), "utf8");

test("MT5 bridge defaults to demo-only with execution disabled", () => {
  assert.match(source, /InpEnableDemoExecution\s*=\s*false/);
  assert.match(source, /ACCOUNT_TRADE_MODE_DEMO/);
  assert.match(source, /LIVE ACCOUNTS ARE REJECTED BY DESIGN/);
});

test("MT5 bridge uses WebRequest HTTPS polling and local duplicate protection", () => {
  assert.match(source, /WebRequest\(method, url/);
  assert.match(source, /https:\/\//);
  assert.match(source, /GlobalVariableCheck\(dedupeKey\)/);
  assert.match(source, /GlobalVariableSet\(dedupeKey, 1\.0\)/);
});

test("MT5 bridge validates account-currency risk and OrderCheck retcode before OrderSend", () => {
  assert.match(source, /OrderCalcProfit\(/);
  assert.match(source, /bool checkPassed = OrderCheck\(request, check\)/);
  assert.match(source, /check\.retcode != 0/);
  assert.match(source, /if\(!sent \|\| !IsSuccessfulRetcode\(result\.retcode\)\)/);
});

test("MT5 bridge acknowledges broker transactions separately from request acceptance", () => {
  assert.match(source, /SendAcknowledgement\(commandId, "ACCEPTED"/);
  assert.match(source, /void OnTradeTransaction\(/);
  assert.match(source, /"PARTIAL"/);
  assert.match(source, /"FILLED"/);
});
