// Chart labels for Target: one target of one Claude Code session, as the repo owner reads it.
export const readerActions = ["WriteTest", "EditTarget", "OutsideEdit", "AskStop"];

const usable = v => v.target.registered && v.result.status !== "none" &&
	v.target.resultGeneration === v.target.generation && v.target.fingerprint === v.content;
const kind = v => !usable(v) ? "pending" : v.result.status === "error" && v.result.attempts < 2 ? "retry" : v.result.status;

function agent(v) {
	if (v.gate.phase !== "idle") return "Stop hook runs";
	if (v.stop === "warned" && v.judged.kind === "below" && v.target.belowBlocks === 0) return "Agent stopped with a warning, and the low score never blocked";
	return { working: "Agent works", blocked: "Agent works", warned: "Agent stopped with a warning", allowed: "Agent stopped, no message" }[v.stop];
}
function targetLabel(v) {
	if (!v.target.registered) return "No test yet";
	const k = kind(v), flight = v.lock !== "free" ? ", run in flight" : "";
	const wrong = usable(v) && v.result.ranOn !== v.content ? " (measured on other file contents)" : "";
	const name = { pending: "Result pending", pass: "Passed", below: "Below threshold", retry: "Error, one retry left", error: "Error, final" }[k];
	return name + wrong + (k === "pending" ? flight : "");
}
export function state(v) {
	return `${agent(v)}: ${targetLabel(v)}`;
}
export const regionNames = ["Agent", "Target"];

export function group(v) {
	if (v.gate.phase !== "idle") return "Stop hook runs";
	if (v.stop === "allowed" || v.stop === "warned") return "Agent stopped";
	return "Agent works";
}

const told = (before, after) => after.stop === "blocked" ? "blocks the agent" : after.stop === "allowed" ? "lets the agent stop with no message" : "lets the agent stop with a warning";
const outcome = r => r.status === "error" ? `an error (${r.agentCaused ? "tests fail" : "infrastructure"}, attempt ${r.attempts})` : r.status === "pass" ? "a pass" : "a score below the threshold";
export function step(action, before, after) {
	switch (action) {
		case "WriteTest": return before.target.registered ? "the agent edits the test" : "the agent writes a test";
		case "EditTarget": return "the agent edits the target";
		case "OutsideEdit": return "the files change with no hook call";
		case "AskStop": return "the agent tries to stop";
		case "RunnerMeasures": return "the runner reads the files";
		case "RunStartsOver": return "the run finds changed files, publishes nothing and starts over";
		case "HandlerStarts": return "the background run starts";
		case "HandlerSkips": return "the background handler finds a result and ends";
		case "HandlerGivesUp": return "the background run finds changed files and publishes nothing";
		case "HandlerPublishes": return `the background run publishes ${outcome(after.result)}`;
		case "GateWaitEnds": return `the wait for the run in flight ends, and the gate ${told(before, after)}`;
		case "GateSeesResult": return `the gate finds the result and ${told(before, after)}`;
		case "GateStartsRun": return "the gate runs the target in the hook";
		case "GateOutOfTime": return `the gate has no time for a run and ${told(before, after)}`;
		case "GateStopsTrying": return `the gate made two runs and ${told(before, after)}`;
		case "GateFindsBusy": return `another run holds the target, and the gate ${told(before, after)}`;
		case "GateRunGivesUp": return after.gate.phase === "idle" ? `the gate's run finds changed files twice, and the gate ${told(before, after)}` : "the gate's run finds changed files twice";
		case "GateRunClipped": return `the gate deadline kills the run, and the gate ${told(before, after)}`;
		case "GateRunPublishes": return after.gate.phase === "idle" ? `the gate's run publishes ${outcome(after.result)}, and the gate ${told(before, after)}` : `the gate's run publishes ${outcome(after.result)}`;
	}
	return action;
}

export function cause(v, facts, invariant) {
	if (invariant === "BelowBlocksBeforeStop") return "the one-time blocks for a pending result and for failing tests used both rounds, so the low score never blocked";
	if (invariant === "GoalNeverStopsClean") return null;
	return "a run published its result although a file it measured was written while it ran (for example changed and changed back), so a result of other contents counts as current";
}
