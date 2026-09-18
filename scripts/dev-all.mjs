// Runs `fabric-ai --serve` and `vite dev` together, so one `npm run dev:all`
// covers both processes this app needs instead of two separate terminals.
//
// fabric-ai's stdin must be explicitly closed, not just left inherited —
// under some parent-process setups (confirmed with a plain Node
// child_process.spawn using the default 'inherit' stdin) fabric-ai blocks
// indefinitely before ever binding its port, never printing anything.
// Explicitly ignoring stdin fixes it and matches how it behaves when run
// standalone. `stdio: ['ignore', ...]` is a Node-level config, so — unlike
// shell redirection such as `< /dev/null` — it works the same on Windows.
import { spawn } from 'node:child_process';

const COLORS = { fabric: '\x1b[33m', vite: '\x1b[32m' };
const RESET = '\x1b[0m';

function runLabeled(name, commandLine) {
	// The whole command goes in one string, with no separate args array —
	// combining shell:true with an args array makes Node emit a DEP0190
	// warning (args aren't escaped when a shell is involved). There's no
	// injection risk here since commandLine is always one of the two fixed
	// strings below, never built from external input.
	const child = spawn(commandLine, {
		shell: true, // lets Windows resolve node_modules/.bin/vite.cmd, etc.
		stdio: ['ignore', 'pipe', 'pipe']
	});

	let buffer = '';
	const onData = (chunk) => {
		buffer += chunk.toString();
		const lines = buffer.split('\n');
		buffer = lines.pop() ?? '';
		for (const line of lines) {
			process.stdout.write(`${COLORS[name] ?? ''}[${name}]${RESET} ${line}\n`);
		}
	};
	child.stdout.on('data', onData);
	child.stderr.on('data', onData);

	return child;
}

const children = [runLabeled('fabric', 'fabric-ai --serve'), runLabeled('vite', 'vite dev')];

let stopping = false;
function stopAll(exitCode) {
	if (stopping) return;
	stopping = true;
	for (const child of children) {
		if (!child.killed) child.kill();
	}
	process.exit(exitCode);
}

for (const child of children) {
	child.on('exit', (code) => {
		if (stopping) return;
		console.log(`\n[dev:all] a process exited (code ${code}) — stopping the other one too.`);
		stopAll(code ?? 1);
	});
	child.on('error', (err) => {
		console.error(`\n[dev:all] failed to start: ${err.message}`);
		stopAll(1);
	});
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
