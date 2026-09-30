import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

export const EMBEDDING_MODEL = "mixedbread-ai/mxbai-embed-xsmall-v1";
export const EMBEDDING_DIMENSIONS = 384;
export type EmbeddingRuntime = "webgpu" | "wasm";

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;
let runtime: EmbeddingRuntime | null = null;

function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

async function createExtractor(device: EmbeddingRuntime, onProgress?: (progress: number) => void) {
  return pipeline("feature-extraction", EMBEDDING_MODEL, {
    device,
    dtype: device === "webgpu" ? "fp16" : "q8",
    progress_callback: (info: unknown) => {
      const progress = Number((info as { progress?: unknown })?.progress);
      if (Number.isFinite(progress)) onProgress?.(Math.max(0, Math.min(100, progress)));
    },
  } as never);
}

export async function getEmbedder(onProgress?: (progress: number) => void) {
  if (extractorPromise && runtime) {
    return { extractor: await extractorPromise, runtime, fallbackUsed: runtime === "wasm" };
  }

  if (hasWebGPU()) {
    runtime = "webgpu";
    extractorPromise = createExtractor("webgpu", onProgress);
    try {
      return { extractor: await extractorPromise, runtime, fallbackUsed: false };
    } catch (error) {
      console.warn("WebGPU embeddings unavailable; falling back to WASM.", error);
      extractorPromise = null;
      runtime = null;
    }
  }

  runtime = "wasm";
  extractorPromise = createExtractor("wasm", onProgress);
  try {
    return { extractor: await extractorPromise, runtime, fallbackUsed: true };
  } catch (error) {
    extractorPromise = null;
    runtime = null;
    throw error;
  }
}

export async function embedTexts(texts: string[], onProgress?: (progress: number) => void) {
  if (!texts.length) return { embeddings: [], runtime: hasWebGPU() ? "webgpu" as const : "wasm" as const, fallbackUsed: !hasWebGPU() };
  const { extractor, runtime, fallbackUsed } = await getEmbedder(onProgress);
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return { embeddings: output.tolist() as number[][], runtime, fallbackUsed };
}

export async function embedText(text: string): Promise<number[]> {
  const result = await embedTexts([text]);
  return result.embeddings[0] ?? [];
}
