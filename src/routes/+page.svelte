<script lang="ts">
	import { onMount } from 'svelte';
	import {
		fetchPatternNames,
		fetchModels,
		fetchGuiConfig,
		fetchYoutubeTranscript,
		fetchContextNames,
		fetchContextContent,
		saveContext,
		deleteContext,
		getPatternDescription,
		getPatternVariables,
		getPatternRawContent,
		resolvePromptPreview,
		applyPatternOnServer,
		joinPromptSections,
		runChat,
		buildCliCommand,
		type UsageMetadata,
		type PatternVariable
	} from '$lib/fabric';

	const FABRIC_REPO = 'https://github.com/danielmiessler/fabric';

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
	let patternVariables = $state<PatternVariable[]>([]);
	let variableValues = $state<Record<string, string>>({});
	let promptPreview = $state('');
	let previewOpen = $state(false);

	// Model + web search
	let models = $state<string[]>([]);
	let selectedModel = $state('');
	let defaultModelLabel = $state('(default)');

	// Contexts: reusable background text, optionally prepended ahead of
	// whichever pattern is run (see the comment on joinPromptSections in
	// $lib/fabric for exactly how). Independent of pattern choice, so the
	// selection persists across pattern switches like Model does.
	let allContexts = $state<string[]>([]);
	let selectedContextName = $state('');
	let contextManagerOpen = $state(false);
	let contextEditorName = $state('');
	let contextEditorContent = $state('');
	let contextSaving = $state(false);
	let contextStatus = $state('');

	// Advanced sampling params. These mirror fabric-ai's own CLI defaults
	// (internal/cli/flags.go) so the panel shows what's actually in effect;
	// each is only sent when changed from its default, matching how the CLI
	// treats an unpassed flag.
	const PARAM_DEFAULTS = {
		temperature: 0.7,
		topP: 0.9,
		presencePenalty: 0.0,
		frequencyPenalty: 0.0
	} as const;
	let advancedOpen = $state(false);
	let temperature = $state(PARAM_DEFAULTS.temperature);
	let topP = $state(PARAM_DEFAULTS.topP);
	let presencePenalty = $state(PARAM_DEFAULTS.presencePenalty);
	let frequencyPenalty = $state(PARAM_DEFAULTS.frequencyPenalty);

	let paramsChanged = $derived(
		temperature !== PARAM_DEFAULTS.temperature ||
			topP !== PARAM_DEFAULTS.topP ||
			presencePenalty !== PARAM_DEFAULTS.presencePenalty ||
			frequencyPenalty !== PARAM_DEFAULTS.frequencyPenalty
	);

	// Only non-default values go on the wire, so an untouched panel behaves
	// exactly as before this feature existed.
	let activeParams = $derived({
		...(temperature !== PARAM_DEFAULTS.temperature ? { temperature } : {}),
		...(topP !== PARAM_DEFAULTS.topP ? { topP } : {}),
		...(presencePenalty !== PARAM_DEFAULTS.presencePenalty ? { presencePenalty } : {}),
		...(frequencyPenalty !== PARAM_DEFAULTS.frequencyPenalty ? { frequencyPenalty } : {})
	});

	function resetParams() {
		temperature = PARAM_DEFAULTS.temperature;
		topP = PARAM_DEFAULTS.topP;
		presencePenalty = PARAM_DEFAULTS.presencePenalty;
		frequencyPenalty = PARAM_DEFAULTS.frequencyPenalty;
	}

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

	// Connection pill in the header — reuses pattern-load state rather than a
	// separate health check, since a failed pattern fetch already means the
	// fabric-ai server isn't reachable.
	let connectionState = $derived.by(() => {
		if (patternsFailedToLoad) {
			return {
				label: 'Offline',
				dot: 'bg-red-500',
				classes:
					'text-red-600 border-red-500/20 bg-red-500/10 dark:text-red-400 dark:border-red-400/20'
			};
		}
		if (allPatterns.length > 0) {
			return {
				label: 'Connected',
				dot: 'bg-emerald-500',
				classes:
					'text-emerald-700 border-emerald-500/20 bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-400/20'
			};
		}
		return {
			label: 'Connecting…',
			dot: 'bg-zinc-400 animate-pulse',
			classes:
				'text-zinc-500 border-zinc-400/20 bg-zinc-400/10 dark:text-zinc-400 dark:border-white/10'
		};
	});

	// Design language: one quiet surface, hierarchy carried by type size and
	// weight rather than colored section chips. Sizes intentionally span a
	// wide range (27px headline → 12px hints) so the eye has somewhere to land.
	const cardClass =
		'rounded-2xl border border-zinc-200 bg-white p-7 dark:border-zinc-800 dark:bg-[#0c0c0e]';

	const fieldClass =
		'w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2.5 text-[0.95rem] text-zinc-900 transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/25 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 dark:border-[#2e2e34] dark:bg-[#141417] dark:text-zinc-50 dark:focus:border-emerald-400';

	const labelClass = 'mb-2 block text-[0.8rem] font-bold text-zinc-700 dark:text-zinc-300';

	const hintClass = 'mt-2 text-[0.8rem] leading-relaxed text-zinc-500 dark:text-zinc-500';

	const ruleClass = 'my-7 h-px bg-zinc-200 dark:bg-[#232327]';

	const ghostClass =
		'flex-1 rounded-[9px] border border-zinc-300 py-2 text-[0.8rem] font-semibold text-zinc-700 transition hover:bg-zinc-900/[0.04] active:scale-[0.98] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:active:scale-100 dark:border-[#2e2e34] dark:text-zinc-300 dark:hover:bg-white/[0.05]';

	onMount(() => {
		const stored = localStorage.getItem('theme');
		isDark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
		applyTheme(isDark);

		loadPatterns();
		loadModels();
		loadDefaultLabel();
		loadContexts();
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

	async function loadContexts() {
		try {
			allContexts = await fetchContextNames();
		} catch {
			// non-fatal; context stays optional, select just shows "(none)"
		}
	}

	function newContext() {
		contextEditorName = '';
		contextEditorContent = '';
		contextStatus = '';
	}

	async function editContext(name: string) {
		contextEditorName = name;
		contextStatus = 'Loading…';
		try {
			contextEditorContent = await fetchContextContent(name);
			contextStatus = '';
		} catch (e) {
			contextStatus = `Failed to load: ${e}`;
		}
	}

	async function saveContextEditor() {
		const name = contextEditorName.trim();
		if (!name) {
			contextStatus = 'Name the context first.';
			return;
		}
		contextSaving = true;
		contextStatus = '';
		try {
			await saveContext(name, contextEditorContent);
			if (!allContexts.includes(name)) allContexts = [...allContexts, name].sort();
			selectedContextName = name;
			contextStatus = 'Saved.';
		} catch (e) {
			contextStatus = `Failed to save: ${e}`;
		} finally {
			contextSaving = false;
		}
	}

	async function deleteContextByName(name: string) {
		contextStatus = '';
		try {
			await deleteContext(name);
			allContexts = allContexts.filter((n) => n !== name);
			if (selectedContextName === name) selectedContextName = '';
			if (contextEditorName === name) newContext();
			contextStatus = 'Deleted.';
		} catch (e) {
			contextStatus = `Failed to delete: ${e}`;
		}
	}

	async function selectPattern(name: string) {
		selectedPattern = name;
		patternQuery = name;
		closeDropdown();
		selectedPatternDesc = 'Loading description…';
		patternVariables = [];
		variableValues = {};
		previewOpen = false;
		const [desc, vars] = await Promise.all([
			getPatternDescription(name),
			getPatternVariables(name)
		]);
		if (selectedPattern !== name) return;
		selectedPatternDesc = desc;
		patternVariables = vars;
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

	// Shared by Run and Preview: resolves a typed-but-never-clicked exact match,
	// then validates the search box holds a real, fully-selected pattern.
	async function resolveSelectedPattern(): Promise<string | null> {
		if (patternQuery.trim() !== selectedPattern) {
			const typed = patternQuery.trim();
			const exact = allPatterns.find((n) => n.toLowerCase() === typed.toLowerCase());
			if (exact) await selectPattern(exact);
		}

		const pattern = selectedPattern;

		if (!pattern || !allPatterns.includes(pattern) || patternQuery.trim() !== pattern) {
			setStatus('Pick a valid pattern from the dropdown list first.', 'error');
			return null;
		}
		return pattern;
	}

	async function previewPrompt() {
		const pattern = await resolveSelectedPattern();
		if (!pattern) return;

		const variables: Record<string, string> = {};
		for (const v of patternVariables) {
			const value = (variableValues[v.name] ?? '').trim();
			if (value) variables[v.name] = value;
		}
		const effectiveInput = hasYoutube
			? `<transcript of ${youtubeUrl.trim()}, fetched when you Run>`
			: inputText.trim() || '<your input>';
		const allVariablesFilled = patternVariables.every((v) => variables[v.name]);

		try {
			let resolvedPattern: string;
			if (allVariablesFilled) {
				// Every variable is filled, so the real endpoint can resolve this
				// exactly like /chat would — more accurate than the client-side
				// approximation below, which stays as the fallback for previewing
				// with some variables still blank (the server's error path for
				// that case collapses to a generic 500, not something to show).
				resolvedPattern = await applyPatternOnServer(pattern, variables, effectiveInput);
			} else {
				const content = await getPatternRawContent(pattern);
				resolvedPattern = resolvePromptPreview(content, variables, effectiveInput);
			}
			// /patterns/:name/apply has no concept of context (confirmed by
			// reading internal/server/patterns.go — ApplyPattern never touches
			// fsdb.Contexts), so context is joined in client-side either way,
			// the same way /chat's real handler joins them server-side.
			const contextContent = selectedContextName
				? await fetchContextContent(selectedContextName)
				: '';
			promptPreview = joinPromptSections(contextContent, resolvedPattern);
			previewOpen = true;
			setStatus('');
		} catch (e) {
			setStatus(`Couldn't load pattern content: ${e}`, 'error');
		}
	}

	function closePreview() {
		previewOpen = false;
	}

	async function run() {
		const pattern = await resolveSelectedPattern();
		if (!pattern) return;

		previewOpen = false;
		if (!hasYoutube && !hasText) {
			setStatus('Enter some input, or a YouTube URL, first.', 'error');
			return;
		}
		const variables: Record<string, string> = {};
		for (const v of patternVariables) {
			const value = (variableValues[v.name] ?? '').trim();
			if (!value) {
				setStatus(`Fill in the "${v.name}" variable this pattern needs.`, 'error');
				return;
			}
			variables[v.name] = value;
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
			webSearch,
			variables,
			contextName: selectedContextName || undefined,
			...activeParams
		});

		try {
			for await (const evt of runChat({
				pattern,
				userInput: text,
				model: selectedModel,
				search: webSearch,
				variables,
				contextName: selectedContextName || undefined,
				...activeParams
			})) {
				if (evt.type === 'content') {
					output += evt.content ?? '';
				} else if (evt.type === 'error') {
					output += `\n[error] ${evt.content}\n`;
				} else if (evt.type === 'usage' && evt.usage) {
					const u: UsageMetadata = evt.usage;
					usageText = `${u.input_tokens} in · ${u.output_tokens} out · ${u.total_tokens} total`;
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

<div class="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-[#09090b] dark:text-zinc-50">
	<!-- header -->
	<header
		class="sticky top-0 z-20 border-b border-zinc-200 bg-zinc-50/80 backdrop-blur-xl dark:border-zinc-800 dark:bg-[#09090b]/80"
	>
		<div class="mx-auto flex max-w-2xl items-center justify-between px-6 py-3">
			<div class="flex items-center gap-2.5">
				<span
					class="flex h-[22px] w-[22px] items-center justify-center rounded-md bg-gradient-to-br from-emerald-400 to-emerald-600"
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-3 w-3">
						<rect x="3" y="3" width="8" height="8" rx="1.5" fill="#fff" />
						<rect x="13" y="3" width="8" height="8" rx="1.5" fill="#fff" opacity="0.55" />
						<rect x="3" y="13" width="8" height="8" rx="1.5" fill="#fff" opacity="0.55" />
						<rect x="13" y="13" width="8" height="8" rx="1.5" fill="#fff" />
					</svg>
				</span>
				<span class="text-[0.9rem] font-bold tracking-tight">Fabric UI</span>
			</div>
			<div class="flex items-center gap-2">
				<span
					class="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold sm:inline-flex {connectionState.classes}"
				>
					<span class="h-[5px] w-[5px] rounded-full {connectionState.dot}"></span>
					{connectionState.label}
				</span>
				<a
					href={FABRIC_REPO}
					target="_blank"
					rel="noopener noreferrer"
					class="hidden items-center gap-1 rounded-md px-2 py-1 text-[0.78rem] font-medium text-zinc-500 transition hover:bg-zinc-900/5 hover:text-zinc-900 sm:inline-flex dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
					title="fabric-ai on GitHub"
				>
					fabric-ai
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						class="h-2.5 w-2.5"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M7 17 17 7M8 7h9v9" />
					</svg>
				</a>
				<button
					onclick={toggleTheme}
					aria-label="Toggle dark mode"
					class="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white"
				>
					{#if isDark}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							class="h-4 w-4"
						>
							<circle cx="12" cy="12" r="4" />
							<path
								stroke-linecap="round"
								d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
							/>
						</svg>
					{:else}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="currentColor"
							class="h-3.5 w-3.5"
						>
							<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
						</svg>
					{/if}
				</button>
			</div>
		</div>
	</header>

	<main class="mx-auto max-w-2xl px-6 pt-10 pb-24">
		<div class={cardClass}>
			<!-- headline -->
			<div
				class="text-[0.7rem] font-bold tracking-[0.1em] text-emerald-600 uppercase dark:text-emerald-400"
			>
				Pattern runner
			</div>
			<h1 class="mt-2 text-[1.7rem] leading-tight font-bold tracking-tight">Run a pattern</h1>
			<p class="mt-2 text-[0.9rem] leading-relaxed text-zinc-500 dark:text-zinc-400">
				Search
				<a
					href={FABRIC_REPO}
					target="_blank"
					rel="noopener noreferrer"
					class="font-medium text-emerald-700 underline decoration-emerald-500/30 underline-offset-2 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-300"
					>fabric-ai</a
				>'s patterns, fill in what they need, and run — without the CLI.
			</p>

			<div class="mt-7"></div>

			<!-- pattern -->
			<div class="relative">
				<label for="patternSearch" class={labelClass}>Pattern</label>
				<input
					id="patternSearch"
					bind:this={patternSearchEl}
					autocomplete="off"
					placeholder={patternsFailedToLoad
						? 'failed to load — is fabric-ai --serve running?'
						: 'Type to search — e.g. extract_wisdom, summarize…'}
					bind:value={patternQuery}
					oninput={openDropdown}
					onfocus={openDropdown}
					onblur={() => setTimeout(closeDropdown, 150)}
					onkeydown={handlePatternKeydown}
					class={fieldClass}
				/>
				{#if dropdownOpen}
					<div
						class="absolute top-[calc(100%+6px)] right-0 left-0 z-10 max-h-72 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-[#2e2e34] dark:bg-[#141417]"
					>
						{#if filteredPatterns.length === 0}
							<div class="px-2.5 py-2 text-[0.85rem] text-zinc-500 dark:text-zinc-400">
								No patterns match.
							</div>
						{:else}
							{#each filteredPatterns as name, i (name)}
								<button
									type="button"
									onmousedown={(e) => {
										e.preventDefault();
										selectPattern(name);
									}}
									class="w-full rounded-lg px-2.5 py-2 text-left transition hover:bg-emerald-500/10 {activeIndex ===
									i
										? 'bg-emerald-500/10'
										: ''}"
								>
									<div class="text-[0.85rem] font-semibold">{name}</div>
									<div class="mt-0.5 text-[0.78rem] text-zinc-500 dark:text-zinc-500">
										{patternDescriptions[name] ?? '…'}
									</div>
								</button>
							{/each}
						{/if}
					</div>
				{/if}
				{#if selectedPatternDesc}
					<p class={hintClass}>{selectedPatternDesc}</p>
				{/if}
			</div>

			<!-- model + first variable side by side -->
			<div class="mt-5 flex flex-wrap gap-4">
				<div class="min-w-[180px] flex-1">
					<label for="model" class={labelClass}>Model</label>
					<select id="model" bind:value={selectedModel} class="cursor-pointer {fieldClass}">
						<option value="">{defaultModelLabel}</option>
						{#each models as m (m)}
							<option value={m}>{m}</option>
						{/each}
					</select>
				</div>
				<div class="min-w-[180px] flex-1">
					<label for="context" class={labelClass}>
						Context
						<span class="font-normal text-zinc-400 dark:text-zinc-600">· optional</span>
					</label>
					<select id="context" bind:value={selectedContextName} class="cursor-pointer {fieldClass}">
						<option value="">(none)</option>
						{#each allContexts as name (name)}
							<option value={name}>{name}</option>
						{/each}
					</select>
				</div>
				{#each patternVariables as v (v.name)}
					<div class="min-w-[180px] flex-1">
						<label for={`var-${v.name}`} class={labelClass}>
							{v.name}
							<span class="font-normal text-zinc-400 dark:text-zinc-600">· required</span>
						</label>
						<input
							id={`var-${v.name}`}
							placeholder={`value for ${v.name}`}
							bind:value={variableValues[v.name]}
							class={fieldClass}
							title={v.hint}
						/>
					</div>
				{/each}
			</div>

			{#if patternVariables.length > 0}
				<p class={hintClass}>
					This pattern leaves blanks for you to fill. fabric-ai doesn't define allowed values, so
					type what the pattern's own wording implies (e.g. a language code like <code
						class="rounded bg-zinc-900/5 px-1 py-0.5 font-mono text-[0.75rem] dark:bg-white/10"
						>fr</code
					>).
				</p>
			{/if}

			<label
				class="mt-4 flex w-fit cursor-pointer items-center gap-2 text-[0.85rem] text-zinc-600 dark:text-zinc-400"
			>
				<input type="checkbox" bind:checked={webSearch} class="accent-emerald-500" />
				Enable web search
			</label>

			<!-- advanced params -->
			<div class="mt-3">
				<button
					type="button"
					onclick={() => (advancedOpen = !advancedOpen)}
					class="flex items-center gap-1.5 text-[0.85rem] font-medium text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						class="h-3.5 w-3.5 transition-transform {advancedOpen ? 'rotate-90' : ''}"
					>
						<path d="m9 6 6 6-6 6" />
					</svg>
					Advanced parameters
					{#if paramsChanged}
						<span
							class="rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[0.65rem] font-bold text-amber-700 dark:border-amber-400/20 dark:text-amber-300"
							>modified</span
						>
					{/if}
				</button>

				{#if advancedOpen}
					<div
						class="mt-3 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-[#232327] dark:bg-white/[0.02]"
					>
						<p class="mb-4 text-[0.78rem] leading-relaxed text-zinc-500 dark:text-zinc-500">
							Only values changed from their defaults are sent. Support varies by vendor: Anthropic
							treats temperature and top-p as mutually exclusive and ignores both penalties; Gemini
							ignores the penalties too. All four apply on OpenAI.
						</p>
						<div class="grid gap-4 sm:grid-cols-2">
							<div>
								<label
									for="temperature"
									class="mb-1.5 flex items-baseline justify-between text-[0.8rem] font-semibold text-zinc-700 dark:text-zinc-300"
								>
									Temperature <span class="font-mono text-zinc-400">{temperature}</span>
								</label>
								<input
									id="temperature"
									type="range"
									min="0"
									max="2"
									step="0.1"
									bind:value={temperature}
									class="w-full accent-emerald-500"
								/>
							</div>
							<div>
								<label
									for="topP"
									class="mb-1.5 flex items-baseline justify-between text-[0.8rem] font-semibold text-zinc-700 dark:text-zinc-300"
								>
									Top-p <span class="font-mono text-zinc-400">{topP}</span>
								</label>
								<input
									id="topP"
									type="range"
									min="0"
									max="1"
									step="0.05"
									bind:value={topP}
									class="w-full accent-emerald-500"
								/>
							</div>
							<div>
								<label
									for="presencePenalty"
									class="mb-1.5 flex items-baseline justify-between text-[0.8rem] font-semibold text-zinc-700 dark:text-zinc-300"
								>
									Presence penalty <span class="font-mono text-zinc-400">{presencePenalty}</span>
								</label>
								<input
									id="presencePenalty"
									type="range"
									min="-2"
									max="2"
									step="0.1"
									bind:value={presencePenalty}
									class="w-full accent-emerald-500"
								/>
							</div>
							<div>
								<label
									for="frequencyPenalty"
									class="mb-1.5 flex items-baseline justify-between text-[0.8rem] font-semibold text-zinc-700 dark:text-zinc-300"
								>
									Frequency penalty <span class="font-mono text-zinc-400">{frequencyPenalty}</span>
								</label>
								<input
									id="frequencyPenalty"
									type="range"
									min="-2"
									max="2"
									step="0.1"
									bind:value={frequencyPenalty}
									class="w-full accent-emerald-500"
								/>
							</div>
						</div>
						<button
							type="button"
							onclick={resetParams}
							disabled={!paramsChanged}
							class="mt-4 rounded-md border border-zinc-300 px-2.5 py-1 text-[0.75rem] font-semibold text-zinc-600 transition hover:bg-zinc-900/[0.04] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent dark:border-[#2e2e34] dark:text-zinc-400 dark:hover:bg-white/[0.05]"
						>
							Reset to defaults
						</button>
					</div>
				{/if}
			</div>

			<!-- manage contexts -->
			<div class="mt-3">
				<button
					type="button"
					onclick={() => (contextManagerOpen = !contextManagerOpen)}
					class="flex items-center gap-1.5 text-[0.85rem] font-medium text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						class="h-3.5 w-3.5 transition-transform {contextManagerOpen ? 'rotate-90' : ''}"
					>
						<path d="m9 6 6 6-6 6" />
					</svg>
					Manage contexts
				</button>

				{#if contextManagerOpen}
					<div
						class="mt-3 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-[#232327] dark:bg-white/[0.02]"
					>
						<p class="mb-4 text-[0.78rem] leading-relaxed text-zinc-500 dark:text-zinc-500">
							Reusable background text, saved once and optionally prepended before whichever pattern
							you run — e.g. a schema's table/column vocabulary a pattern shouldn't have to guess at
							every time.
						</p>

						{#if allContexts.length > 0}
							<div class="mb-4 flex flex-wrap gap-1.5">
								{#each allContexts as name (name)}
									<span
										class="inline-flex items-center gap-1 rounded-full border border-zinc-300 py-1 pr-1 pl-2.5 text-[0.75rem] dark:border-[#2e2e34]"
									>
										<button
											type="button"
											onclick={() => editContext(name)}
											class="font-medium hover:underline"
										>
											{name}
										</button>
										<button
											type="button"
											onclick={() => deleteContextByName(name)}
											aria-label={`Delete ${name}`}
											title={`Delete ${name}`}
											class="rounded-full px-1.5 text-zinc-400 transition hover:bg-red-500/10 hover:text-red-500"
										>
											×
										</button>
									</span>
								{/each}
							</div>
						{:else}
							<p class="mb-4 text-[0.78rem] text-zinc-500 dark:text-zinc-500">
								No saved contexts yet.
							</p>
						{/if}

						<div>
							<label for="contextName" class={labelClass}>Name</label>
							<input
								id="contextName"
								placeholder="e.g. genie-sales-schema"
								bind:value={contextEditorName}
								class={fieldClass}
							/>
						</div>
						<div class="mt-3">
							<label for="contextContent" class={labelClass}>Content</label>
							<textarea
								id="contextContent"
								placeholder="Background text prepended before the pattern's own instructions…"
								bind:value={contextEditorContent}
								class="min-h-[100px] resize-y leading-relaxed {fieldClass}"></textarea>
						</div>
						<div class="mt-3 flex items-center gap-2">
							<button
								type="button"
								onclick={saveContextEditor}
								disabled={contextSaving}
								class="rounded-md bg-emerald-600 px-3 py-1.5 text-[0.78rem] font-semibold text-white transition hover:brightness-110 disabled:cursor-default disabled:opacity-50"
							>
								{contextSaving ? 'Saving…' : 'Save'}
							</button>
							<button
								type="button"
								onclick={newContext}
								class="rounded-md border border-zinc-300 px-3 py-1.5 text-[0.78rem] font-semibold text-zinc-600 transition hover:bg-zinc-900/[0.04] dark:border-[#2e2e34] dark:text-zinc-400 dark:hover:bg-white/[0.05]"
							>
								New
							</button>
							{#if contextStatus}
								<span class="text-[0.78rem] text-zinc-500 dark:text-zinc-500">{contextStatus}</span>
							{/if}
						</div>
					</div>
				{/if}
			</div>

			<div class={ruleClass}></div>

			<!-- input -->
			<div>
				<label for="youtube" class={labelClass}>
					YouTube URL
					<span class="font-normal text-zinc-400 dark:text-zinc-600">· optional</span>
				</label>
				<input
					id="youtube"
					placeholder="https://www.youtube.com/watch?v=..."
					bind:value={youtubeUrl}
					disabled={youtubeDisabled}
					class={fieldClass}
				/>
			</div>

			<div class="mt-5">
				<label for="input" class={labelClass}>Your input</label>
				<textarea
					id="input"
					placeholder="Type or paste what you want to send through the pattern…"
					bind:value={inputText}
					disabled={inputDisabled}
					class="min-h-[120px] resize-y leading-relaxed {fieldClass}"></textarea>
				<p class={hintClass}>Fill in one or the other — a YouTube URL, or text here.</p>
			</div>

			<!-- actions -->
			<div class="mt-7">
				<button
					onclick={run}
					disabled={running}
					class="flex w-full items-center justify-center gap-2 rounded-[10px] bg-gradient-to-b from-emerald-500 to-emerald-600 py-3 text-[0.95rem] font-bold text-white shadow-[0_6px_18px_-6px_rgba(16,185,129,0.55)] transition hover:brightness-110 active:scale-[0.99] disabled:cursor-default disabled:opacity-50 disabled:hover:brightness-100 disabled:active:scale-100"
				>
					{#if running}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="none"
							class="h-4 w-4 animate-spin"
						>
							<circle
								cx="12"
								cy="12"
								r="9"
								stroke="currentColor"
								stroke-width="2.5"
								opacity="0.25"
							/>
							<path
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								d="M21 12a9 9 0 0 0-9-9"
							/>
						</svg>
						Running…
					{:else}
						Run pattern
					{/if}
				</button>
				<div class="mt-2.5 flex gap-2">
					<button onclick={previewPrompt} class={ghostClass}>Preview</button>
					<button onclick={copyOutput} class={ghostClass}>Copy</button>
					<button onclick={clearOutput} class={ghostClass}>Clear</button>
					<button
						onclick={chainOutput}
						disabled={!hasOutput}
						title="Load this output as the input for a new pattern run"
						class="flex-1 rounded-[9px] border border-emerald-500/40 py-2 text-[0.8rem] font-semibold text-emerald-600 transition hover:bg-emerald-500/10 active:scale-[0.98] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:active:scale-100 dark:border-emerald-400/40 dark:text-emerald-400"
						>Use as input</button
					>
				</div>

				{#if status}
					<div class="mt-3 flex items-center gap-1.5 text-[0.85rem] font-medium">
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
					</div>
				{/if}
			</div>

			<!-- prompt preview -->
			{#if previewOpen}
				<div class={ruleClass}></div>
				<div>
					<div class="mb-2 flex items-baseline justify-between gap-2">
						<span class="text-[0.8rem] font-bold text-violet-700 dark:text-violet-300"
							>Prompt preview</span
						>
						<button
							onclick={closePreview}
							class="text-[0.78rem] text-zinc-500 transition hover:text-zinc-900 dark:hover:text-zinc-100"
							>close</button
						>
					</div>
					<p class="mb-2.5 text-[0.78rem] text-zinc-500 dark:text-zinc-500">
						Exactly what would be sent as the system message. Nothing was sent — no tokens used.
						{#if selectedContextName}
							Includes the "<span class="font-mono">{selectedContextName}</span>" context,
							prepended.
						{/if}
					</p>
					<div
						class="max-h-80 overflow-y-auto rounded-lg border border-l-2 border-zinc-200 border-l-violet-500 bg-zinc-50 p-3.5 font-mono text-[0.82rem] leading-relaxed whitespace-pre-wrap dark:border-[#232327] dark:border-l-violet-400 dark:bg-[#0a0a0c]"
					>
						{promptPreview}
					</div>
				</div>
			{/if}

			<div class={ruleClass}></div>

			<!-- output -->
			<div>
				<div class="mb-2 flex items-baseline justify-between gap-2">
					<span class="text-[0.8rem] font-bold text-zinc-700 dark:text-zinc-300">Output</span>
					{#if usageText}
						<span class="font-mono text-[0.72rem] text-zinc-400 dark:text-zinc-600"
							>{usageText}</span
						>
					{/if}
				</div>
				{#if hasOutput || running}
					<div
						class="rounded-lg border border-l-2 border-zinc-200 border-l-emerald-500 bg-zinc-50 p-3.5 text-[0.9rem] leading-relaxed whitespace-pre-wrap dark:border-[#232327] dark:border-l-emerald-500 dark:bg-[#0a0a0c]"
					>
						{output}
					</div>
				{:else}
					<div
						class="rounded-lg border border-dashed border-zinc-300 py-10 text-center text-[0.85rem] text-zinc-400 dark:border-[#2e2e34] dark:text-zinc-600"
					>
						Output will appear here
					</div>
				{/if}
			</div>

			<!-- cli equivalent -->
			<div class="mt-5">
				<div class="mb-2 text-[0.8rem] font-bold text-zinc-700 dark:text-zinc-300">
					Equivalent fabric-ai command
				</div>
				<div
					class="overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 font-mono text-[0.78rem] whitespace-pre text-zinc-500 dark:border-[#232327] dark:bg-[#0a0a0c] dark:text-zinc-500"
				>
					{cliCommand}
				</div>
			</div>
		</div>

		<p class="mt-6 text-center text-[0.75rem] text-zinc-400 dark:text-zinc-600">
			fabric-ui — an open, local UI for
			<a
				href={FABRIC_REPO}
				target="_blank"
				rel="noopener noreferrer"
				class="underline decoration-dotted hover:text-zinc-600 dark:hover:text-zinc-400"
				>fabric-ai</a
			>. Not affiliated with or endorsed by the fabric project.
		</p>
	</main>
</div>
