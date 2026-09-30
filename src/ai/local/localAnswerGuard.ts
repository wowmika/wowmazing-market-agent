const HIDDEN_TAG_NAMES =
  "think|analysis|reasoning|reflection|scratchpad|chain[_ -]?of[_ -]?thought|cot|internal|deliberation";
const SOURCE_TAG = /\[(M|F|S|R\d+)\]/gi;
const NUMBER_WORDS =
  "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|once|twice|half|quarter|dozen|single|double|triple|few|several|multiple";
const SENSITIVE_CLAIM =
  /\b(?:support|resistance|entry|target|stop[ -]?loss|catalyst|news|earnings|announced|acquisition|merger|partnership|launch|lawsuit|investigation|guidance|recommend(?:ed|ation)?|buy|sell|long|short|bullish|bearish|neutral|strong|weak|higher|lower|rising|falling|surge|drop|decline|improv\w*|deteriorat\w*)\b/gi;
const LOW_INFORMATION = new Set([
  "about", "above", "after", "again", "against", "also", "among", "because", "before", "being",
  "below", "between", "both", "brief", "could", "deterministic", "does", "evidence", "factual",
  "from", "have", "into", "local", "market", "more", "only", "other", "panel", "provides",
  "qualitative", "remain", "remains", "should", "shows", "supplied", "than", "that", "their",
  "there", "these", "they", "this", "those", "through", "under", "using", "with", "within",
]);

function stripHiddenReasoning(text: string): string {
  const htmlBlock = new RegExp(
    `<\\s*(${HIDDEN_TAG_NAMES})\\b[^>]*>[\\s\\S]*?(?:<\\s*\\/\\s*\\1\\s*>|$)`,
    "gi",
  );
  const tokenBlock = new RegExp(
    `<\\|(${HIDDEN_TAG_NAMES})\\|>[\\s\\S]*?(?:<\\|\\/\\1\\|>|$)`,
    "gi",
  );
  return text
    .replace(htmlBlock, " ")
    .replace(tokenBlock, " ")
    .replace(new RegExp(`<\\s*\\/?\\s*(?:${HIDDEN_TAG_NAMES})\\b[^>]*>`, "gi"), " ")
    .replace(new RegExp(`<\\|\\/?(?:${HIDDEN_TAG_NAMES})\\|>`, "gi"), " ")
    .replace(/<\|(?:im_start|im_end|fim_prefix|fim_middle|fim_suffix)\|>/gi, " ")
    .replace(/```[\w-]*|```/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .trim();
}

function sentenceList(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.match(/[^.!?]+[.!?]?/g) ?? [])
    .map((sentence) => sentence.trim().replace(/^[-*•]\s*/, ""))
    .filter(Boolean);
}

function supportedTokens(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [])
      .filter((token) => !LOW_INFORMATION.has(token)),
  );
}

function hasNumericClaim(sentence: string): boolean {
  const withoutSourceTags = sentence.replace(SOURCE_TAG, "");
  return /\d|[%$€£¥₹]|\b(?:percent|percentage|basis points?|bps)\b/i.test(withoutSourceTags) ||
    new RegExp(`\\b(?:${NUMBER_WORDS})\\b`, "i").test(withoutSourceTags);
}

function hasUnsupportedSensitiveClaim(
  sentence: string,
  citedSources: string[],
): boolean {
  const sourceText = citedSources.join(" ").toLowerCase();
  const terms = sentence.match(SENSITIVE_CLAIM) ?? [];
  return terms.some((term) => {
    const normalized = term.toLowerCase().replace(/[ -]/g, "");
    const sourceTerms = sourceText.match(/[a-z]+/g) ?? [];
    return !sourceTerms.some((sourceTerm) => sourceTerm.replace(/[ -]/g, "") === normalized);
  });
}

function hasSourceSupport(sentence: string, citedSources: string[]): boolean {
  const claimText = sentence.replace(SOURCE_TAG, " ");
  const claimTokens = supportedTokens(claimText);
  const sourceTokens = supportedTokens(citedSources.join(" "));
  return [...claimTokens].some((token) => sourceTokens.has(token));
}

/** Removes hidden reasoning and keeps only concise, cited, non-numeric claims grounded in packet sources. */
export function sanitizeLocalNarrative(
  rawText: string,
  sources: Record<string, string>,
): { answer: string; adjusted: boolean } {
  const cleaned = stripHiddenReasoning(rawText);
  const accepted: string[] = [];
  let adjusted = cleaned !== rawText.trim();

  for (const sentence of sentenceList(cleaned)) {
    const citations = [...sentence.matchAll(SOURCE_TAG)].map((match) => match[1].toUpperCase());
    const citedSources = citations
      .filter((source) => Object.prototype.hasOwnProperty.call(sources, source))
      .map((source) => sources[source]);
    const uncited = citations.length === 0 || citedSources.length !== citations.length;

    if (
      uncited ||
      hasNumericClaim(sentence) ||
      hasUnsupportedSensitiveClaim(sentence, citedSources) ||
      !hasSourceSupport(sentence, citedSources)
    ) {
      adjusted = true;
      continue;
    }
    accepted.push(sentence);
  }

  let answer = accepted.join(" ").replace(/\s+/g, " ").trim();
  if (adjusted && answer) {
    answer += " Numeric or unverified claims were withheld; use the deterministic panels for exact values.";
  }
  if (!answer) {
    answer = "No source-checked local narrative was available. Use the deterministic market and risk panels and Research Evidence for verified facts.";
    adjusted = true;
  }
  if (answer.length > 900) {
    answer = `${answer.slice(0, 897).trimEnd()}…`;
    adjusted = true;
  }

  return { answer, adjusted };
}
