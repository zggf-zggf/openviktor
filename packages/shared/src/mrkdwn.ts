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

	// Protect fenced code blocks from conversion
	result = result.replace(/```[\s\S]*?```/g, (m) => protect(m));

	// Protect inline code from conversion
	result = result.replace(/`[^`\n]+`/g, (m) => protect(m));

	// Headings: # text → *text* (strip bold markers inside since heading is bold)
	result = result.replace(/^#{1,6}\s+(.+)$/gm, (_, heading) => {
		const h = heading.trim().replace(/\*{2,3}(.+?)\*{2,3}/g, "$1");
		return protect(`*${h}*`);
	});

	// Images ![alt](url) → <url|alt>
	result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => protect(`<${url}|${alt}>`));

	// Links [text](url) → <url|text>
	result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, url) => protect(`<${url}|${t}>`));

	// Bold+italic ***text*** → *_text_*
	result = result.replace(/\*{3}(.+?)\*{3}/g, (_, inner) => protect(`*_${inner}_*`));

	// Bold **text** → *text*
	result = result.replace(/\*{2}(.+?)\*{2}/g, (_, inner) => protect(`*${inner}*`));

	// Italic *text* → _text_ (single asterisks with non-whitespace boundaries)
	result = result.replace(/\*([^\s*](?:[^*\n]*[^\s*])?)\*/g, "_$1_");

	// Strikethrough ~~text~~ → ~text~
	result = result.replace(/~~(.+?)~~/g, "~$1~");

	// Horizontal rules (lines with only dashes, asterisks, or underscores)
	result = result.replace(/^[-*_]{3,}\s*$/gm, "─────────────────");

	// Restore protected content (reverse order for nested protections)
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
	if (text.length <= maxLength) return [text];

	const chunks: string[] = [];
	let remaining = text;

	while (remaining.length > maxLength) {
		// Try paragraph boundary
		let splitAt = remaining.lastIndexOf("\n\n", maxLength);

		// Fall back to line boundary
		if (splitAt === -1 || splitAt < maxLength * 0.3) {
			splitAt = remaining.lastIndexOf("\n", maxLength);
		}

		// Fall back to word boundary
		if (splitAt === -1 || splitAt < maxLength * 0.3) {
			splitAt = remaining.lastIndexOf(" ", maxLength);
		}

		// Hard cut as last resort
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
