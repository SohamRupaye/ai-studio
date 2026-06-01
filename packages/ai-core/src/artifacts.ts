import type { Store } from "@ai-studio/database";

interface ExtractedArtifact {
  type: string;
  title: string;
  content: string;
}

const ARTIFACT_PATTERNS: Array<{ type: string; pattern: RegExp; titleExtractor: (match: RegExpMatchArray) => string }> = [
  { type: "code", pattern: /```(?:[\w]+)?\n([\s\S]{200,}?)```/g, titleExtractor: (m) => extractCodeTitle(m[0]!) },
  { type: "prd", pattern: /(?:^|\n)#\s+(?:PRD|Product Requirements|Requirements Document)[^\n]*\n([\s\S]{300,}?)(?=\n#\s|\n---|\z)/gi, titleExtractor: (m) => m[0]!.split("\n")[0]!.replace(/^#\s+/, "") },
  { type: "architecture", pattern: /(?:^|\n)#\s+(?:Architecture|System Design|Technical Design)[^\n]*\n([\s\S]{300,}?)(?=\n#\s|\n---|\z)/gi, titleExtractor: (m) => m[0]!.split("\n")[0]!.replace(/^#\s+/, "") },
  { type: "plan", pattern: /(?:^|\n)#\s+(?:Plan|Implementation Plan|Roadmap|Action Plan)[^\n]*\n([\s\S]{200,}?)(?=\n#\s|\n---|\z)/gi, titleExtractor: (m) => m[0]!.split("\n")[0]!.replace(/^#\s+/, "") },
  { type: "research", pattern: /(?:^|\n)#\s+(?:Research|Analysis|Investigation|Findings)[^\n]*\n([\s\S]{300,}?)(?=\n#\s|\n---|\z)/gi, titleExtractor: (m) => m[0]!.split("\n")[0]!.replace(/^#\s+/, "") },
];

function extractCodeTitle(block: string): string {
  const langMatch = block.match(/```(\w+)/);
  const lang = langMatch?.[1] || "code";
  const lines = block.split("\n").filter(l => l.trim() && !l.startsWith("```"));
  // Try to find a filename or function/class definition
  const fileLine = lines.find(l => /(?:\/\/|#|\/\*)\s*(?:file|filename):/i.test(l));
  if (fileLine) return fileLine.replace(/(?:\/\/|#|\/\*)\s*(?:file|filename):\s*/i, "").trim();
  const defLine = lines.find(l => /^(?:export\s+)?(?:function|class|interface|type|const|def|fn|pub)\s+\w+/.test(l));
  if (defLine) return `${lang}: ${defLine.slice(0, 60).trim()}`;
  return `${lang} snippet (${lines.length} lines)`;
}

/** Detect artifact-worthy content in an assistant response. */
export function detectArtifacts(text: string): ExtractedArtifact[] {
  const artifacts: ExtractedArtifact[] = [];
  const seen = new Set<string>();

  for (const { type, pattern, titleExtractor } of ARTIFACT_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const content = match[0]!;
      // Skip small code blocks (not artifact-worthy)
      if (type === "code" && content.length < 300) continue;
      const title = titleExtractor(match);
      const key = `${type}:${title.slice(0, 50)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      artifacts.push({ type, title, content });
    }
  }

  return artifacts;
}

/** Extract and persist artifacts from an assistant message. */
export function extractAndPersistArtifacts(
  store: Store,
  text: string,
  branchId: string,
  projectId: string,
): Array<{ id: string; type: string; title: string }> {
  const detected = detectArtifacts(text);
  const saved: Array<{ id: string; type: string; title: string }> = [];

  for (const artifact of detected) {
    const result = store.createArtifact(branchId, projectId, artifact.type, artifact.title, artifact.content);
    saved.push({ id: result.id, type: artifact.type, title: artifact.title });
  }

  return saved;
}
