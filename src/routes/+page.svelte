<script lang="ts">
	import { onMount } from 'svelte';
	import {
		fetchPatternNames,
		fetchModels,
		fetchGuiConfig,
		fetchYoutubeTranscript,
		getPatternDescription,
		runChat,
		buildCliCommand,
		type UsageMetadata
	} from '$lib/fabric';

	// Theme
	let isDark = $state(true);

	function applyTheme(dark: boolean) {
		document.documentElement.classList.toggle('dark', dark);
		localStorage.setItem('theme', dark ? 'dark' : 'light');
	}

	function toggleTheme() {
		isDark = !isDark;
		applyTheme(isDark);
	}

	// Pattern search/select
	let allPatterns = $state<string[]>([]);
	let patternQuery = $state('');
	let selectedPattern = $state('');
	let dropdownOpen = $state(false);
	let activeIndex = $state(-1);
	let selectedPatternDesc = $state('');
	let patternDescriptions = $state<Record<string, string>>({});
	let patternsFailedToLoad = $state(false);

	// Model + web search
	let models = $state<string[]>([]);
	let selectedModel = $state('');
	let defaultModelLabel = $state('(default)');

	// Input
	let youtubeUrl = $state('');
	let inputText = $state('');
	let hasYoutube = $derived(youtubeUrl.trim().length > 0);
	let hasText = $derived(inputText.trim().length > 0);
	let inputDisabled = $derived(hasYoutube);
	let youtubeDisabled = $derived(hasText && !hasYoutube);
	let webSearch = $state(false);

	// Run state
	let output = $state('');
	let status = $state('');
	let statusKind = $state<'idle' | 'success' | 'error'>('idle');
	let usageText = $state('');
	let cliCommand = $state('—');
	let running = $state(false);
	let hasOutput = $derived(output.trim().length > 0);
	let patternSearchEl = $state<HTMLInputElement | undefined>();

	let filteredPatterns = $derived.by(() => {
		const q = patternQuery.trim().toLowerCase();
		const matches = q ? allPatterns.filter((n) => n.toLowerCase().includes(q)) : allPatterns;
		return matches.slice(0, 200);
	});

	onMount(() => {
		const stored = localStorage.getItem('theme');
		isDark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
		applyTheme(isDark);

		loadPatterns();
		loadModels();
		loadDefaultLabel();
	});

	async function loadPatterns() {
		try {
			allPatterns = await fetchPatternNames();
			// deliberately no default selection — the search box's placeholder
			// shows an example instead, and the user picks explicitly.
		} catch {
			patternsFailedToLoad = true;
		}
	}

	async function loadModels() {
		try {
			const data = await fetchModels();
			models = [...(data.models ?? [])].sort();
		} catch {
			// non-fatal; default model still works
		}
	}

	async function loadDefaultLabel() {
		const config = await fetchGuiConfig();
		if (config.defaultModel) defaultModelLabel = `(default — ${config.defaultModel})`;
	}

	async function selectPattern(name: string) {
		selectedPattern = name;
		patternQuery = name;
		closeDropdown();
		selectedPatternDesc = 'Loading description…';
		const desc = await getPatternDescription(name);
		if (selectedPattern === name) selectedPatternDesc = desc;
	}

	function closeDropdown() {
		dropdownOpen = false;
		activeIndex = -1;
	}

	function openDropdown() {
		dropdownOpen = true;
		activeIndex = -1;
		// lazily fetch descriptions for whatever's currently visible
		for (const name of filteredPatterns) {
			if (patternDescriptions[name] === undefined) {
				getPatternDescription(name).then((d) => {
					patternDescriptions[name] = d;
				});
			}
		}
	}

	function handlePatternKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (!dropdownOpen) {
				openDropdown();
				return;
			}
			activeIndex = Math.min(activeIndex + 1, filteredPatterns.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			activeIndex = Math.max(activeIndex - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (activeIndex >= 0 && filteredPatterns[activeIndex]) {
				selectPattern(filteredPatterns[activeIndex]);
			} else if (filteredPatterns.length === 1) {
				selectPattern(filteredPatterns[0]);
			}
		} else if (e.key === 'Escape') {
			closeDropdown();
		}
	}

	function setStatus(text: string, kind: 'idle' | 'success' | 'error' = 'idle') {
		status = text;
		statusKind = kind;
	}

	async function run() {
		// resolve an exact typed match that was never explicitly clicked/selected
		if (patternQuery.trim() !== selectedPattern) {
			const typed = patternQuery.trim();
			const exact = allPatterns.find((n) => n.toLowerCase() === typed.toLowerCase());
			if (exact) await selectPattern(exact);
		}

		const pattern = selectedPattern;

		if (!pattern || !allPatterns.includes(pattern) || patternQuery.trim() !== pattern) {
			setStatus('Pick a valid pattern from the dropdown list first.', 'error');
			return;
		}
		if (!hasYoutube && !hasText) {
			setStatus('Enter some input, or a YouTube URL, first.', 'error');
			return;
		}

		output = '';
		running = true;
		let text = inputText.trim();

		if (hasYoutube) {
			output = 'Fetching YouTube transcript…';
			setStatus('');
			try {
				const yt = await fetchYoutubeTranscript(youtubeUrl.trim());
				text = yt.transcript;
				inputText = `Title: ${yt.title}\n\n${yt.transcript}`;
				output = 'Transcript fetched. Running pattern…';
			} catch (e) {
				output = `Failed to fetch transcript: ${e}\n\nIs fabric-ai --serve running on port 8080?`;
				setStatus('Failed.', 'error');
				running = false;
				return;
			}
		}

		setStatus('Running…');
		output = '';
		usageText = '';
		cliCommand = buildCliCommand({
			pattern,
			model: selectedModel,
			youtubeUrl: hasYoutube ? youtubeUrl.trim() : undefined,
			webSearch
		});

		try {
			for await (const evt of runChat({
				pattern,
				userInput: text,
				model: selectedModel,
				search: webSearch
			})) {
				if (evt.type === 'content') {
					output += evt.content ?? '';
				} else if (evt.type === 'error') {
					output += `\n[error] ${evt.content}\n`;
				} else if (evt.type === 'usage' && evt.usage) {
					const u: UsageMetadata = evt.usage;
					usageText = `Tokens — input: ${u.input_tokens}, output: ${u.output_tokens}, total: ${u.total_tokens}`;
				} else if (evt.type === 'complete') {
					setStatus('Done.', 'success');
				}
			}
			if (status === 'Running…') setStatus('Done.', 'success');
		} catch (e) {
			output = `Request failed: ${e}\n\nIs fabric-ai --serve running on port 8080?`;
			setStatus('Failed.', 'error');
		} finally {
			running = false;
		}
	}

	function clearOutput() {
		output = '';
		setStatus('');
	}

	function copyOutput() {
		navigator.clipboard.writeText(output);
		setStatus('Copied to clipboard.', 'success');
	}

	// Pattern chaining, minimal version: load this run's output as the next
	// run's input, so the user just picks a new pattern and hits Run — instead
	// of manually copying output, clearing input, pasting, and switching
	// patterns by hand. A full visual pipeline builder is a later step.
	function chainOutput() {
		if (!hasOutput) return;
		inputText = output.trim();
		youtubeUrl = '';
		output = '';
		usageText = '';
		cliCommand = '—';
		setStatus('Loaded previous output as input — pick a new pattern and Run.', 'idle');
		patternSearchEl?.focus();
		patternSearchEl?.select();
		patternSearchEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}
</script>

<svelte:head>
	<title>Fabric UI</title>
</svelte:head>

<div
	class="relative min-h-screen bg-zinc-50 text-zinc-900 [background-image:radial-gradient(circle_at_1px_1px,rgba(0,0,0,0.045)_1px,transparent_0)] [background-size:22px_22px] dark:bg-zinc-950 dark:text-zinc-50 dark:[background-image:radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.06)_1px,transparent_0)]"
>
	<!-- ambient glow -->
	<div
		class="pointer-events-none fixed inset-0 bg-[radial-gradient(900px_480px_at_20%_-5%,theme(colors.emerald.200/0.5),transparent_60%)] dark:bg-[radial-gradient(900px_480px_at_20%_-5%,theme(colors.emerald.500/0.12),transparent_60%)]"
	></div>

	<!-- header -->
	<header
		class="sticky top-0 z-20 border-b border-zinc-900/5 bg-zinc-50/70 backdrop-blur-xl dark:border-white/5 dark:bg-zinc-950/70"
	>
		<div class="mx-auto flex max-w-3xl items-center justify-between px-5 py-3.5">
			<div class="flex items-center gap-2">
				<span
					class="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 text-sm shadow-sm shadow-emerald-500/30"
					>🧵</span
				>
				<span
					class="bg-gradient-to-r from-zinc-900 to-zinc-600 bg-clip-text text-[0.95rem] font-bold tracking-tight text-transparent dark:from-white dark:to-zinc-400"
					>Fabric UI</span
				>
			</div>
			<button
				onclick={toggleTheme}
				aria-label="Toggle dark mode"
				class="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
			>
				{#if isDark}
					<!-- sun -->
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4.5 w-4.5">
						<circle cx="12" cy="12" r="4" />
						<path
							stroke-linecap="round"
							d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
						/>
					</svg>
				{:else}
					<!-- moon -->
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-4 w-4">
						<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
					</svg>
				{/if}
			</button>
		</div>
	</header>

	<main class="relative mx-auto flex max-w-3xl flex-col gap-6 px-5 pt-8 pb-24">
		<p class="text-sm text-zinc-500 dark:text-zinc-400">
			A local interface for fabric-ai patterns — search, run, and inspect output without the CLI.
		</p>

		<div
			class="flex flex-col gap-6 rounded-3xl bg-white/80 p-7 shadow-[0_1px_1px_rgba(20,20,40,0.03),0_16px_40px_-12px_rgba(20,20,40,0.12)] ring-1 ring-zinc-900/5 backdrop-blur-xl dark:bg-white/[0.03] dark:shadow-[0_1px_1px_rgba(0,0,0,0.3),0_16px_40px_-12px_rgba(0,0,0,0.6)] dark:ring-white/10"
		>
			<!-- Pattern & Model -->
			<section class="flex flex-col gap-3">
				<div class="flex items-center gap-1.5 text-[0.7rem] font-bold tracking-wider text-zinc-400 uppercase dark:text-zinc-500">
					<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
					Pattern &amp; Model
				</div>
				<div class="flex flex-wrap gap-3.5">
					<div class="relative min-w-[200px] flex-1">
						<label for="patternSearch" class="mb-1.5 block text-sm font-medium text-zinc-500 dark:text-zinc-400"
							>Pattern (type to search)</label
						>
						<input
							id="patternSearch"
							bind:this={patternSearchEl}
							autocomplete="off"
							placeholder={patternsFailedToLoad
							? 'failed to load — is fabric-ai --serve running?'
							: 'e.g. tighten_prompt, extract_wisdom, summarize…'}
							bind:value={patternQuery}
							oninput={openDropdown}
							onfocus={openDropdown}
							onblur={() => setTimeout(closeDropdown, 150)}
							onkeydown={handlePatternKeydown}
							class="w-full rounded-xl border-0 bg-zinc-900/[0.04] px-3.5 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-900/5 transition focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none dark:bg-white/5 dark:text-zinc-50 dark:ring-white/10 dark:focus:bg-white/[0.07] dark:focus:ring-emerald-400/70"
						/>
						{#if dropdownOpen}
							<div
								class="absolute top-[calc(100%+8px)] right-0 left-0 z-10 max-h-70 overflow-y-auto rounded-2xl bg-white/95 p-1.5 shadow-2xl ring-1 ring-zinc-900/5 backdrop-blur-xl dark:bg-zinc-900/95 dark:ring-white/10"
							>
								{#if filteredPatterns.length === 0}
									<div class="px-2.5 py-2 text-sm text-zinc-500 dark:text-zinc-400">No patterns match.</div>
								{:else}
									{#each filteredPatterns as name, i (name)}
										<button
											type="button"
											onmousedown={(e) => {
												e.preventDefault();
												selectPattern(name);
											}}
											class="w-full rounded-xl px-3 py-2 text-left text-sm transition hover:bg-emerald-500/10 {activeIndex ===
											i
												? 'bg-emerald-500/10'
												: ''}"
										>
											<div class="font-semibold text-zinc-900 dark:text-zinc-50">{name}</div>
											<div class="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
												{patternDescriptions[name] ?? '…'}
											</div>
										</button>
									{/each}
								{/if}
							</div>
						{/if}
					</div>

					<div class="min-w-[200px] flex-1">
						<label for="model" class="mb-1.5 block text-sm font-medium text-zinc-500 dark:text-zinc-400"
							>Model (leave as default to use your configured model)</label
						>
						<select
							id="model"
							bind:value={selectedModel}
							class="w-full cursor-pointer rounded-xl border-0 bg-zinc-900/[0.04] px-3.5 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-900/5 transition focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none dark:bg-white/5 dark:text-zinc-50 dark:ring-white/10 dark:focus:bg-white/[0.07] dark:focus:ring-emerald-400/70"
						>
							<option value="">{defaultModelLabel}</option>
							{#each models as m (m)}
								<option value={m}>{m}</option>
							{/each}
						</select>
						<label class="mt-2.5 flex cursor-pointer items-center gap-2 text-[0.82rem] text-zinc-600 dark:text-zinc-300">
							<input type="checkbox" bind:checked={webSearch} class="accent-emerald-500" />
							Enable web search (model looks up live info, not just training data — only works on models/vendors that
							support it)
						</label>
					</div>
				</div>
				{#if selectedPatternDesc}
					<div class="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{selectedPatternDesc}</div>
				{/if}
			</section>

			<!-- Input -->
			<section class="flex flex-col gap-3 border-t border-zinc-900/5 pt-5.5 dark:border-white/10">
				<div class="flex items-center gap-1.5 text-[0.7rem] font-bold tracking-wider text-zinc-400 uppercase dark:text-zinc-500">
					<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
					Input
				</div>
				<div>
					<label for="youtube" class="mb-1.5 block text-sm font-medium text-zinc-500 dark:text-zinc-400"
						>YouTube URL (leave blank if you're typing/pasting input below instead)</label
					>
					<input
						id="youtube"
						placeholder="https://www.youtube.com/watch?v=..."
						bind:value={youtubeUrl}
						disabled={youtubeDisabled}
						class="w-full rounded-xl border-0 bg-zinc-900/[0.04] px-3.5 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-900/5 transition focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/5 dark:text-zinc-50 dark:ring-white/10 dark:focus:bg-white/[0.07] dark:focus:ring-emerald-400/70"
					/>
				</div>
				<div>
					<label for="input" class="mb-1.5 block text-sm font-medium text-zinc-500 dark:text-zinc-400"
						>Your input (skip this if you filled in a YouTube URL above)</label
					>
					<textarea
						id="input"
						placeholder="Type or paste what you want to send through the pattern..."
						bind:value={inputText}
						disabled={inputDisabled}
						class="min-h-[120px] w-full resize-y rounded-xl border-0 bg-zinc-900/[0.04] px-3.5 py-2.5 text-sm leading-relaxed text-zinc-900 ring-1 ring-zinc-900/5 transition focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white/5 dark:text-zinc-50 dark:ring-white/10 dark:focus:bg-white/[0.07] dark:focus:ring-emerald-400/70"
					></textarea>
				</div>
			</section>

			<!-- Run -->
			<section class="flex flex-col gap-3 border-t border-zinc-900/5 pt-5.5 dark:border-white/10">
				<div class="flex items-center gap-1.5 text-[0.7rem] font-bold tracking-wider text-zinc-400 uppercase dark:text-zinc-500">
					<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
					Run
				</div>
				<div class="flex flex-wrap items-center gap-2.5">
					<button
						onclick={run}
						disabled={running}
						class="rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/25 transition hover:brightness-110 active:scale-[0.98] disabled:cursor-default disabled:opacity-50 disabled:hover:brightness-100 disabled:active:scale-100"
					>
						{running ? 'Running…' : 'Run'}
					</button>
					<button
						onclick={clearOutput}
						class="rounded-xl px-4.5 py-2.5 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-900/10 transition hover:bg-zinc-900/[0.04] active:scale-[0.98] dark:text-zinc-200 dark:ring-white/10 dark:hover:bg-white/[0.06]"
					>
						Clear output
					</button>
					<button
						onclick={copyOutput}
						class="rounded-xl px-4.5 py-2.5 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-900/10 transition hover:bg-zinc-900/[0.04] active:scale-[0.98] dark:text-zinc-200 dark:ring-white/10 dark:hover:bg-white/[0.06]"
					>
						Copy output
					</button>
					<button
						onclick={chainOutput}
						disabled={!hasOutput}
						title="Load this output as the input for a new pattern run"
						class="rounded-xl px-4.5 py-2.5 text-sm font-semibold text-emerald-600 ring-1 ring-emerald-500/30 transition hover:bg-emerald-500/10 active:scale-[0.98] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:active:scale-100 dark:text-emerald-400 dark:ring-emerald-400/30"
					>
						Use as input →
					</button>
					<span class="flex min-h-[1.1rem] items-center gap-1.5 text-sm font-medium">
						{#if running}
							<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"></span>
						{/if}
						<span
							class={statusKind === 'success'
								? 'text-emerald-600 dark:text-emerald-400'
								: statusKind === 'error'
									? 'text-red-600 dark:text-red-400'
									: 'text-zinc-500 dark:text-zinc-400'}>{status}</span
						>
					</span>
				</div>

				<div>
					<div class="mb-1.5 text-sm font-medium text-zinc-500 dark:text-zinc-400">Equivalent fabric-ai command</div>
					<div
						class="overflow-x-auto rounded-xl bg-zinc-900/[0.04] px-3.5 py-2.5 font-mono text-[0.78rem] whitespace-pre text-zinc-500 ring-1 ring-zinc-900/5 dark:bg-white/5 dark:text-zinc-400 dark:ring-white/10"
					>
						{cliCommand}
					</div>
				</div>

				<div>
					<div class="mb-1.5 text-sm font-medium text-zinc-500 dark:text-zinc-400">Output</div>
					<div
						class="min-h-[130px] rounded-xl bg-zinc-900/[0.04] px-4 py-4 font-mono text-[0.87rem] leading-relaxed whitespace-pre-wrap text-zinc-900 ring-1 ring-zinc-900/5 dark:bg-white/5 dark:text-zinc-50 dark:ring-white/10"
					>
						{output}
					</div>
					<div class="mt-1.5 min-h-[1.1rem] text-sm text-zinc-500 dark:text-zinc-400">{usageText}</div>
				</div>
			</section>
		</div>

		<p class="text-center text-xs text-zinc-400 dark:text-zinc-600">fabric-ui-advanced — a local, open rebuild</p>
	</main>
</div>
