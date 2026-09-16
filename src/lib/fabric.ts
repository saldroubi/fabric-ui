// Typed client for fabric-ai's REST API, called through our own /api/fabric/*
// same-origin proxy (see src/routes/api/fabric/[...path]/+server.ts).

export interface UsageMetadata {
	input_tokens: number;
	output_tokens: number;
	total_tokens: number;
}

export interface StreamEvent {
	type: 'content' | 'usage' | 'error' | 'complete';
	format?: string;
	content?: string;
	usage?: UsageMetadata;
}

export interface ModelsResponse {
	models: string[];
	vendors: Record<string, string[]>;
}

export interface YoutubeTranscript {
	transcript: string;
	title: string;
	videoId: string;
	description: string;
}

export interface GuiConfig {
	defaultVendor: string;
	defaultModel: string;
}

export interface ChatRunOptions {
	pattern: string;
	userInput: string;
	model?: string;
	search?: boolean;
	variables?: Record<string, string>;
	thinking?: string;
	temperature?: number;
	topP?: number;
	presencePenalty?: number;
	frequencyPenalty?: number;
}

// Advanced sampling params — all four are genuinely copied into ChatOptions
// by internal/server/chat.go's /chat handler (verified by reading it), unlike
// most other CLI-only ChatOptions fields. Vendor behavior differs though:
// - Anthropic (internal/plugins/ai/anthropic/anthropic.go): Temperature and
//   TopP are mutually exclusive — setting TopP away from its default (0.9)
//   makes the plugin send only TopP and silently drop Temperature entirely.
//   PresencePenalty/FrequencyPenalty aren't referenced at all — silent no-ops.
// - OpenAI: all four apply as expected.
// - Gemini: Temperature and TopP apply; the penalties aren't referenced —
//   silent no-ops, same as Anthropic.
// So penalties only do anything on OpenAI-compatible vendors, and on
// Anthropic only one of Temperature/TopP wins. No vendor rejects these the
// way Anthropic rejects thinking+temperature!=1, so unlike the thinking
// control this is safe to expose — just not uniformly meaningful everywhere.

// Reasoning/"thinking" levels fabric-ai's ChatOptions.Thinking accepts
// (internal/domain/thinking.go) — empty string means "don't ask for any
// particular level, use the vendor's default."
export const THINKING_LEVELS = [
	{ value: '', label: '(default)' },
	{ value: 'off', label: 'Off' },
	{ value: 'low', label: 'Low' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'high', label: 'High' }
] as const;

export async function fetchPatternNames(): Promise<string[]> {
	const res = await fetch('/api/fabric/patterns/names');
	if (!res.ok) throw new Error(`Failed to load patterns (${res.status})`);
	const names: string[] = await res.json();
	return [...names].sort();
}

export async function fetchModels(): Promise<ModelsResponse> {
	const res = await fetch('/api/fabric/models/names');
	if (!res.ok) throw new Error(`Failed to load models (${res.status})`);
	return res.json();
}

export async function fetchGuiConfig(): Promise<GuiConfig> {
	const res = await fetch('/api/gui-config');
	if (!res.ok) return { defaultVendor: '', defaultModel: '' };
	return res.json();
}

export async function fetchYoutubeTranscript(url: string): Promise<YoutubeTranscript> {
	const res = await fetch('/api/fabric/youtube/transcript', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ url })
	});
	const data = await res.json();
	if (!res.ok) throw new Error(data.error ?? `Failed to fetch transcript (${res.status})`);
	return data;
}

// Every fabric pattern's system.md starts with an "# IDENTITY [and PURPOSE]"
// section describing what it does — pull that out as a human-readable
// description instead of forcing users to guess from the pattern's name.
export function extractDescription(patternContent: string): string {
	if (!patternContent) return '';
	let text = patternContent;
	const idx = text.search(/#\s*IDENTITY/i);
	if (idx >= 0) text = text.slice(idx);
	text = text.replace(/^#[^\n]*\n+/, ''); // drop the heading line itself, whatever it says
	const nextHeading = text.search(/\n#/);
	if (nextHeading >= 0) text = text.slice(0, nextHeading);
	text = text.trim().replace(/\s+/g, ' ');
	if (text.length > 220) text = text.slice(0, 217) + '…';
	return text;
}

// A pattern's variables: every distinct {{name}} placeholder it references
// (besides the built-in {{input}}), plus a short snippet of the surrounding
// prose so the user has some idea what to type — fabric-ai itself attaches
// no type/description/allowed-values metadata to these, so this snippet is
// the only hint available. See ROADMAP.md for why there's no dropdown here.
export interface PatternVariable {
	name: string;
	hint: string;
}

const RESERVED_VARIABLE_NAMES = new Set(['input']);

export function extractVariables(patternContent: string): PatternVariable[] {
	if (!patternContent) return [];
	const seen = new Map<string, string>();
	const re = /\{\{([a-zA-Z0-9_]+)\}\}/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(patternContent))) {
		const name = match[1];
		if (RESERVED_VARIABLE_NAMES.has(name) || seen.has(name)) continue;

		const start = Math.max(0, match.index - 60);
		const end = Math.min(patternContent.length, match.index + match[0].length + 40);
		let hint = patternContent.slice(start, end).replace(/\s+/g, ' ').trim();
		if (start > 0) hint = `…${hint}`;
		if (end < patternContent.length) hint = `${hint}…`;
		seen.set(name, hint);
	}
	return [...seen.entries()].map(([name, hint]) => ({ name, hint }));
}

const patternContentCache = new Map<string, string>();

async function fetchPatternRaw(name: string): Promise<string> {
	const cached = patternContentCache.get(name);
	if (cached !== undefined) return cached;
	const res = await fetch(`/api/fabric/patterns/${encodeURIComponent(name)}`);
	const data = await res.json();
	const content: string = data.Pattern ?? '';
	patternContentCache.set(name, content);
	return content;
}

export async function getPatternDescription(name: string): Promise<string> {
	try {
		const content = await fetchPatternRaw(name);
		return extractDescription(content) || '(no description found in this pattern)';
	} catch {
		return ''; // don't cache failures — retry next time
	}
}

export async function getPatternVariables(name: string): Promise<PatternVariable[]> {
	try {
		const content = await fetchPatternRaw(name);
		return extractVariables(content);
	} catch {
		return [];
	}
}

export async function getPatternRawContent(name: string): Promise<string> {
	return fetchPatternRaw(name);
}

// Client-side stand-in for fabric-ai's CLI-only `--dry-run`: reproduces what
// internal/plugins/db/fsdb/patterns.go's applyVariables/ensureInput do server-
// side (only named variables that actually have a value get substituted, and
// {{input}} is appended if the pattern doesn't already reference it) so the
// preview matches what /chat would actually send as the system message.
export function resolvePromptPreview(
	patternContent: string,
	variables: Record<string, string>,
	input: string
): string {
	let text = patternContent;
	for (const [name, value] of Object.entries(variables)) {
		if (!value) continue;
		text = text.split(`{{${name}}}`).join(value);
	}
	if (!text.includes('{{input}}')) {
		text = (text.endsWith('\n') ? text : text + '\n') + '{{input}}';
	}
	return text.split('{{input}}').join(input);
}

// Byte-accurate version of the same preview, used when every variable the
// pattern needs has a value: calls fabric-ai's own POST /patterns/:name/apply
// (internal/server/patterns.go), the same GetApplyVariables resolution /chat
// itself uses, instead of approximating it client-side. Its error responses
// don't include the underlying reason (server-side storageError collapses
// anything that isn't a name-validation failure into a generic 500 "internal
// error" — see internal/server/storage.go), so this is only reliable when the
// caller already knows every variable is filled; resolvePromptPreview above
// remains the fallback for partial previews.
export async function applyPatternOnServer(
	name: string,
	variables: Record<string, string>,
	input: string
): Promise<string> {
	const res = await fetch(`/api/fabric/patterns/${encodeURIComponent(name)}/apply`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ input, variables })
	});
	const data = await res.json();
	if (!res.ok) throw new Error(data.error ?? `Failed to apply pattern (${res.status})`);
	return data.Pattern ?? '';
}

// Streams a pattern run as an async generator of parsed SSE events, so
// callers can just `for await (const evt of runChat(...))`.
export async function* runChat(opts: ChatRunOptions): AsyncGenerator<StreamEvent> {
	// Anthropic's API hard-rejects (400) any request with thinking enabled
	// unless temperature is exactly 1 — verified live via plain CLI
	// (`fabric-ai -p translate --thinking high` 400s with "temperature may
	// only be set to 1 when thinking is enabled"). fabric-ai itself doesn't
	// coordinate the two despite --raw's flag text claiming "smart parameter
	// selection" for Anthropic — no such logic actually exists in the
	// plugin. The reasoning dropdown that would set opts.thinking isn't
	// currently wired up in the UI (see ROADMAP.md — it hit an unrelated,
	// unfixed upstream bug), but this coupling stays here so an explicit
	// caller-supplied temperature always wins if one's ever given alongside
	// thinking; Gemini/OpenAI accept temperature 1 fine either way.
	const thinkingEnabled = !!opts.thinking && opts.thinking !== 'off';
	const temperature = opts.temperature ?? (thinkingEnabled ? 1 : undefined);

	const res = await fetch('/api/fabric/chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			prompts: [
				{
					userInput: opts.userInput,
					patternName: opts.pattern,
					vendor: '',
					model: opts.model ?? '',
					variables: opts.variables ?? {}
				}
			],
			language: 'en',
			search: opts.search ?? false,
			thinking: opts.thinking ?? '',
			...(temperature !== undefined ? { temperature } : {}),
			...(opts.topP !== undefined ? { topP: opts.topP } : {}),
			...(opts.presencePenalty !== undefined ? { presencePenalty: opts.presencePenalty } : {}),
			...(opts.frequencyPenalty !== undefined ? { frequencyPenalty: opts.frequencyPenalty } : {})
		})
	});

	if (!res.ok || !res.body) {
		const errText = await res.text();
		throw new Error(`Error ${res.status}: ${errText}`);
	}

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		const parts = buffer.split('\n\n');
		buffer = parts.pop() ?? '';

		for (const part of parts) {
			const line = part.trim();
			if (!line.startsWith('data:')) continue;
			const jsonStr = line.slice(5).trim();
			if (!jsonStr) continue;
			try {
				yield JSON.parse(jsonStr) as StreamEvent;
			} catch {
				continue;
			}
		}
	}
}

export function shellQuote(s: string): string {
	return `"${s.replace(/(["\\$`])/g, '\\$1')}"`;
}

export function buildCliCommand(opts: {
	pattern: string;
	model?: string;
	youtubeUrl?: string;
	webSearch?: boolean;
	variables?: Record<string, string>;
	thinking?: string;
	temperature?: number;
	topP?: number;
	presencePenalty?: number;
	frequencyPenalty?: number;
}): string {
	let cmd = 'fabric-ai';
	if (opts.youtubeUrl) cmd += ` -y ${shellQuote(opts.youtubeUrl)}`;
	cmd += ` -p ${opts.pattern || '<pattern>'}`;
	if (opts.model) cmd += ` -m ${opts.model}`;
	if (opts.webSearch) cmd += ` --search`;
	if (opts.thinking && opts.thinking !== 'off') {
		// Anthropic 400s any thinking-enabled request unless temperature is
		// exactly 1 — see the matching comment in runChat for the verified repro.
		cmd += ` --thinking ${opts.thinking} --temperature 1`;
	} else if (opts.thinking === 'off') {
		cmd += ` --thinking off`;
	} else if (opts.temperature !== undefined) {
		cmd += ` -t ${opts.temperature}`;
	}
	if (opts.topP !== undefined) cmd += ` -T ${opts.topP}`;
	if (opts.presencePenalty !== undefined) cmd += ` -P ${opts.presencePenalty}`;
	if (opts.frequencyPenalty !== undefined) cmd += ` -F ${opts.frequencyPenalty}`;
	for (const [name, value] of Object.entries(opts.variables ?? {})) {
		cmd += ` -v=${name}:${value}`;
	}
	if (!opts.youtubeUrl) cmd = `echo <your input> | ${cmd}`;
	return cmd;
}
