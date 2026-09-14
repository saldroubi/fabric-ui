import type { RequestHandler } from './$types';

// Same-origin proxy to fabric-ai --serve. fabric-ai's REST API only sets
// CORS headers on /chat (hardcoded to http://localhost:5173, matching its
// own official web app's dev port) — every other endpoint (/patterns,
// /models, /youtube/transcript, ...) sends none at all, so a browser
// calling it directly would have those requests silently blocked. Running
// server-side here sidesteps CORS entirely: this is a server-to-server
// call, not a browser cross-origin request.
const BACKEND = 'http://127.0.0.1:8080';

const proxy: RequestHandler = async ({ params, request, url }) => {
	const targetUrl = `${BACKEND}/${params.path}${url.search}`;

	const headers = new Headers(request.headers);
	headers.delete('host'); // don't forward the dev server's own Host header upstream

	const init: RequestInit = { method: request.method, headers };
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		init.body = await request.arrayBuffer();
	}

	const upstream = await fetch(targetUrl, init);

	// Stream the body straight through (critical for /chat's SSE stream —
	// buffering it here would defeat the point of a live-updating UI).
	const respHeaders = new Headers(upstream.headers);
	respHeaders.delete('content-encoding');
	respHeaders.delete('content-length');

	return new Response(upstream.body, {
		status: upstream.status,
		headers: respHeaders
	});
};

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
