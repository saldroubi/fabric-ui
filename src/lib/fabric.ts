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
}

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

const descriptionCache = new Map<string, string>();

export async function getPatternDescription(name: string): Promise<string> {
	const cached = descriptionCache.get(name);
	if (cached !== undefined) return cached;
	try {
		const res = await fetch(`/api/fabric/patterns/${encodeURIComponent(name)}`);
		const data = await res.json();
		const desc = extractDescription(data.Pattern) || '(no description found in this pattern)';
		descriptionCache.set(name, desc);
		return desc;
	} catch {
		return ''; // don't cache failures — retry next time
	}
}

// Streams a pattern run as an async generator of parsed SSE events, so
// callers can just `for await (const evt of runChat(...))`.
export async function* runChat(opts: ChatRunOptions): AsyncGenerator<StreamEvent> {
	const res = await fetch('/api/fabric/chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			prompts: [
				{
					userInput: opts.userInput,
					patternName: opts.pattern,
					vendor: '',
					model: opts.model ?? ''
				}
			],
			language: 'en',
			search: opts.search ?? false
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
}): string {
	let cmd = 'fabric-ai';
	if (opts.youtubeUrl) cmd += ` -y ${shellQuote(opts.youtubeUrl)}`;
	cmd += ` -p ${opts.pattern || '<pattern>'}`;
	if (opts.model) cmd += ` -m ${opts.model}`;
	if (opts.webSearch) cmd += ` --search`;
	if (!opts.youtubeUrl) cmd = `echo <your input> | ${cmd}`;
	return cmd;
}
