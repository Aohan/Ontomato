const STABLE_STREAM_CHUNK_SIZE = 120;
export function chunkText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

function stableChunks(content: string, chunkSize = STABLE_STREAM_CHUNK_SIZE): string[] {
  const text = String(content || "");
  if (!text) return [];

  const chunks: string[] = [];
  for (let index = chunkSize; index < text.length; index += chunkSize) {
    chunks.push(text.slice(0, index));
  }
  chunks.push(text);
  return chunks;
}

export function pushStableContent(
  content: string,
  pushContent: (content: string, loading: boolean) => void
) {
  const chunks = stableChunks(content);
  if (chunks.length === 0) return;

  for (const chunk of chunks.slice(0, -1)) {
    pushContent(chunk, true);
  }
  pushContent(chunks[chunks.length - 1], false);
}
