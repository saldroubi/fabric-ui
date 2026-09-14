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
		loadPatterns();
		loadModels();
		loadDefaultLabel();
	});

	async function loadPatterns() {
		try {
			allPatterns = await fetchPatternNames();
			await selectPattern(allPatterns.includes('tighten_prompt') ? 'tighten_prompt' : (allPatterns[0] ?? ''));
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
	class="flex min-h-screen flex-col items-center bg-[radial-gradient(1000px_500px_at_15%_-10%,theme(colors.emerald.100),transparent_60%)] px-5 py-12 pb-20 dark:bg-[radial-gradient(1000px_500px_at_15%_-10%,theme(colors.emerald.950),transparent_60%)] dark:bg-zinc-950"
>
	<div class="mb-6 w-full max-w-3xl">
		<h1 class="flex items-center gap-2 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
			🧵 Fabric UI
		</h1>
		<p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
			A local interface for fabric-ai patterns — search, run, and inspect output without the CLI.
		</p>
	</div>

	<div
		class="flex w-full max-w-3xl flex-col gap-6 rounded-2xl border border-zinc-200 bg-white p-7 shadow-[0_1px_2px_rgba(20,20,40,0.04),0_8px_24px_rgba(20,20,40,0.06)] dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-[0_1px_2px_rgba(0,0,0,0.2),0_12px_32px_rgba(0,0,0,0.35)]"
	>
		<!-- Pattern & Model -->
		<section class="flex flex-col gap-3">
			<div class="text-[0.7rem] font-bold tracking-wider text-zinc-400 uppercase dark:text-zinc-500">
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
						placeholder={patternsFailedToLoad ? 'failed to load — is fabric-ai --serve running?' : 'Search patterns…'}
						bind:value={patternQuery}
						oninput={openDropdown}
						onfocus={openDropdown}
						onblur={() => setTimeout(closeDropdown, 150)}
						onkeydown={handlePatternKeydown}
						class="w-full rounded-[9px] border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-900 focus:border-emerald-500 focus:ring-3 focus:ring-emerald-100 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:focus:ring-emerald-900/40"
					/>
					{#if dropdownOpen}
						<div
							class="absolute top-[calc(100%+6px)] right-0 left-0 z-10 max-h-70 overflow-y-auto rounded-[9px] border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
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
										class="w-full rounded-lg px-2.5 py-2 text-left text-sm hover:bg-emerald-50 dark:hover:bg-emerald-900/30 {activeIndex ===
										i
											? 'bg-emerald-50 dark:bg-emerald-900/30'
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
						class="w-full cursor-pointer rounded-[9px] border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-900 focus:border-emerald-500 focus:ring-3 focus:ring-emerald-100 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:focus:ring-emerald-900/40"
					>
						<option value="">{defaultModelLabel}</option>
						{#each models as m (m)}
							<option value={m}>{m}</option>
						{/each}
					</select>
					<label class="mt-2.5 flex cursor-pointer items-center gap-2 text-[0.82rem] text-zinc-700 dark:text-zinc-300">
						<input type="checkbox" bind:checked={webSearch} class="accent-emerald-600" />
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
		<section class="flex flex-col gap-3 border-t border-zinc-200 pt-5.5 dark:border-zinc-800">
			<div class="text-[0.7rem] font-bold tracking-wider text-zinc-400 uppercase dark:text-zinc-500">Input</div>
			<div>
				<label for="youtube" class="mb-1.5 block text-sm font-medium text-zinc-500 dark:text-zinc-400"
					>YouTube URL (leave blank if you're typing/pasting input below instead)</label
				>
				<input
					id="youtube"
					placeholder="https://www.youtube.com/watch?v=..."
					bind:value={youtubeUrl}
					disabled={youtubeDisabled}
					class="w-full rounded-[9px] border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-900 focus:border-emerald-500 focus:ring-3 focus:ring-emerald-100 focus:outline-none disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:focus:ring-emerald-900/40 dark:disabled:bg-zinc-700"
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
					class="min-h-[120px] w-full resize-y rounded-[9px] border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm leading-relaxed text-zinc-900 focus:border-emerald-500 focus:ring-3 focus:ring-emerald-100 focus:outline-none disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:focus:ring-emerald-900/40 dark:disabled:bg-zinc-700"
				></textarea>
			</div>
		</section>

		<!-- Run -->
		<section class="flex flex-col gap-3 border-t border-zinc-200 pt-5.5 dark:border-zinc-800">
			<div class="text-[0.7rem] font-bold tracking-wider text-zinc-400 uppercase dark:text-zinc-500">Run</div>
			<div class="flex flex-wrap items-center gap-2.5">
				<button
					onclick={run}
					disabled={running}
					class="rounded-[9px] bg-emerald-600 px-4.5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-default disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-400"
				>
					Run
				</button>
				<button
					onclick={clearOutput}
					class="rounded-[9px] border border-zinc-300 px-4.5 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-50 dark:hover:bg-zinc-800"
				>
					Clear output
				</button>
				<button
					onclick={copyOutput}
					class="rounded-[9px] border border-zinc-300 px-4.5 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-50 dark:hover:bg-zinc-800"
				>
					Copy output
				</button>
				<button
					onclick={chainOutput}
					disabled={!hasOutput}
					title="Load this output as the input for a new pattern run"
					class="rounded-[9px] border border-emerald-300 px-4.5 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
				>
					Use as input →
				</button>
				<span
					class="min-h-[1.1rem] text-sm font-medium {statusKind === 'success'
						? 'text-emerald-600 dark:text-emerald-400'
						: statusKind === 'error'
							? 'text-red-600 dark:text-red-400'
							: 'text-zinc-500 dark:text-zinc-400'}">{status}</span
				>
			</div>

			<div>
				<div class="mb-1.5 text-sm font-medium text-zinc-500 dark:text-zinc-400">Equivalent fabric-ai command</div>
				<div
					class="overflow-x-auto rounded-[9px] border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 font-mono text-[0.78rem] whitespace-pre text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
				>
					{cliCommand}
				</div>
			</div>

			<div>
				<div class="mb-1.5 text-sm font-medium text-zinc-500 dark:text-zinc-400">Output</div>
				<div
					class="min-h-[130px] rounded-[9px] border border-zinc-200 bg-zinc-50 px-4 py-4 font-mono text-[0.87rem] leading-relaxed whitespace-pre-wrap text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
				>
					{output}
				</div>
				<div class="mt-1.5 min-h-[1.1rem] text-sm text-zinc-500 dark:text-zinc-400">{usageText}</div>
			</div>
		</section>
	</div>
</div>
