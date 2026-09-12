// Shared tokenization for loose text search — used by the similar-threads
// endpoint and TerpBot's thread/query commands. Pure module, safe to import
// anywhere.

export const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "for", "of", "to", "in", "on", "at", "with", "by", "from",
  "my", "your", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "may", "might", "can", "i", "you", "he", "she", "it", "we", "they",
  "this", "that", "these", "those", "what", "how", "help", "please", "need", "question", "about",
])

// Lowercase, strip punctuation, drop stop words and short tokens.
export function tokenizeSearchText(text: string, max = 8): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, max)
}
