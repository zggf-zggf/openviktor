const SLACK_MAX_LENGTH = 3000;

/**
 * Convert standard Markdown to Slack mrkdwn format.
 *
 * Key conversions: **bold** → *bold*, *italic* → _italic_,
 * [text](url) → <url|text>, # heading → *heading*
 */
export function markdownToMrkdwn(text: string): string {
	if (!text) return text;

	const slots: string[] = [];
	const protect = (content: string): string => {
		const i = slots.length;
		slots.push(content);
		return `\x00${i}\x00`;
	};

	let result = text;

	result = result.replace(/```[\s\S]*?```/g, (m) => protect(m));
	result = result.replace(/`[^`\n]+`/g, (m) => protect(m));

	// # heading → *heading*
	result = result.replace(/^#{1,6}\s+(.+)$/gm, (_, heading) => {
		const h = heading.trim().replace(/\*{2,3}(.+?)\*{2,3}/g, "$1");
		return protect(`*${h}*`);
	});

	// ![alt](url) → <url|alt>
	result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => protect(`<${url}|${alt}>`));
	// [text](url) → <url|text>
	result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, url) => protect(`<${url}|${t}>`));
	// ***text*** → *_text_*
	result = result.replace(/\*{3}(.+?)\*{3}/g, (_, inner) => protect(`*_${inner}_*`));
	// **text** → *text*
	result = result.replace(/\*{2}(.+?)\*{2}/g, (_, inner) => protect(`*${inner}*`));
	// *text* → _text_
	result = result.replace(/\*([^\s*](?:[^*\n]*[^\s*])?)\*/g, "_$1_");
	// ~~text~~ → ~text~
	result = result.replace(/~~(.+?)~~/g, "~$1~");
	// --- / *** → ─────
	result = result.replace(/^[-*_]{3,}\s*$/gm, "─────────────────");

	for (let i = slots.length - 1; i >= 0; i--) {
		result = result.replace(`\x00${i}\x00`, slots[i]);
	}

	return result;
}

/**
 * Split a message into chunks that fit within Slack's display limits.
 * Prefers splitting at paragraph, line, or word boundaries.
 */
export function chunkMessage(text: string, maxLength = SLACK_MAX_LENGTH): string[] {
	if (maxLength <= 0) {
		throw new Error("maxLength must be a positive integer");
	}

	if (text.length <= maxLength) return [text];

	const chunks: string[] = [];
	let remaining = text;

	while (remaining.length > maxLength) {
		let splitAt = remaining.lastIndexOf("\n\n", maxLength);

		if (splitAt === -1 || splitAt < maxLength * 0.3) {
			splitAt = remaining.lastIndexOf("\n", maxLength);
		}

		if (splitAt === -1 || splitAt < maxLength * 0.3) {
			splitAt = remaining.lastIndexOf(" ", maxLength);
		}

		if (splitAt === -1 || splitAt < maxLength * 0.3) {
			splitAt = maxLength;
		}

		chunks.push(remaining.slice(0, splitAt).trimEnd());
		remaining = remaining.slice(splitAt).trimStart();
	}

	if (remaining.length > 0) {
		chunks.push(remaining);
	}

	return chunks;
}
