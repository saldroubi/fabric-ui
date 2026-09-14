import { json } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Reads fabric-ai's own config so the UI can show what "(default)" model
// actually resolves to, instead of a vague placeholder.
export async function GET() {
	const envPath = join(homedir(), '.config', 'fabric', '.env');
	let defaultVendor = '';
	let defaultModel = '';

	try {
		const content = await readFile(envPath, 'utf-8');
		for (const rawLine of content.split('\n')) {
			const line = rawLine.trim();
			if (line.startsWith('DEFAULT_VENDOR=')) {
				defaultVendor = line.slice('DEFAULT_VENDOR='.length);
			} else if (line.startsWith('DEFAULT_MODEL=')) {
				defaultModel = line.slice('DEFAULT_MODEL='.length);
			}
		}
	} catch {
		// no .env file yet — leave both empty, UI falls back to a generic label
	}

	return json({ defaultVendor, defaultModel });
}
