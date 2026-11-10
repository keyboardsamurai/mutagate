'use strict';
// Agent-caused runner errors, required lazily by runTarget. An error is agent-caused when the output of a failing
// runner command names a test or an edited production file, or when a runner reports that
// the tests are red before mutating (baseline red). Such an error blocks Stop once; any other error fails open.
const fs = require('node:fs');

const BASELINE_RED = [
  /did not pass without mutation/, // PIT
  /failed tests in the initial test run|tests failed in the initial test run/, // StrykerJS
  /Initial testrun has (?:more than 50% )?failing tests/, // Stryker.NET
  /Tests don't run cleanly without mutations|failed to collect stats\. runner returned|Failed to run clean test/, // mutmut 2, 3
  // gomutants wraps every failure of its baseline `go test` ("coverage run failed"), so only a failing test or a test file compile error counts
  /^--- FAIL: |_test\.go:\d+:\d+: /
];

// Returns the line that shows the cause, or '' when the error is not agent-caused. The runner log holds one JSON entry
// per command; only failing commands count, and only their output, since arguments name the tests anyway.
function agentCause(message, files = [], log, isTest = () => false) {
  let text = String(message);
  // mutagate's own errors ("no .csproj above <test>") name tests without being their fault; command failures ("<exe> failed (1): ...") quote output.
  const own = /^[\w.-]+ failed \(/.test(text) ? 0 : text.split('\n').length;
  try {
    for (const line of fs.readFileSync(log, 'utf8').split('\n')) {
      const entry = line ? JSON.parse(line) : null;
      if (entry && entry.code) text += '\n' + entry.error + '\n' + entry.output;
    }
  } catch {}
  // Any non-warning line naming a session file or a test-glob match is a cause.
  const cause = text.split('\n').map(l => l.trim()).find((l, i) => BASELINE_RED.some(p => p.test(l)) ||
    i >= own && (files.some(f => l.includes(f)) || (l.match(/[\w./\\-]+\.(java|kt|py|tsx?|jsx?|go|cs)\b/g) || []).some(isTest)) && !/\bwarning\b|^w: /i.test(l));
  // pytest names the test on a red baseline.
  return (BASELINE_RED.some(p => p.test(cause)) && text.match(/^FAILED \S+::.*/m)?.[0] || cause || '').slice(0, 300);
}

// History skips undersized attempts; the advised wait (+1 s for gate setup) funds a full-budget attempt, which is final.
function gateAdvice(budget, cap, ms, elapsed, cli) {
  if (budget >= cap || budget * 1000 >= (ms || 0)) return '';
  return ms >= cap * 1000 ? '; raise runBudgetSec or split the test' : `; needs about ${Math.ceil(ms / 1000)} s; run ${cli} check --wait ${Math.ceil(elapsed / 1000) + cap + 1}`;
}
module.exports = { agentCause, BASELINE_RED, gateAdvice };
