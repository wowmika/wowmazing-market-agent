import { LOCAL_LLM_MODEL, type LocalLLMMessage } from "./webllmRuntime";

type Request =
  | { id: number; type: "init" }
  | { id: number; type: "generate"; messages: LocalLLMMessage[] }
  | { id: number; type: "reset" }
  | { id: number; type: "cancel"; generationId: number };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown): void;
};
let enginePromise: Promise<import("@mlc-ai/web-llm").MLCEngine> | null = null;
let operationQueue = Promise.resolve();
let generationPending = false;
let activeGenerationId: number | null = null;
let resetting = false;
const cancelledGenerations = new Set<number>();

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function getEngine(id: number): Promise<import("@mlc-ai/web-llm").MLCEngine> {
  if (!("gpu" in navigator)) throw new Error("WebGPU is not available in this browser/device.");
  if (!enginePromise) {
    enginePromise = (async () => {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
      if (!gpu || !(await gpu.requestAdapter())) {
        throw new Error("WebGPU is not available: no GPU adapter was found.");
      }
      const webllm = await import("@mlc-ai/web-llm");
      const appConfig = {
        ...webllm.prebuiltAppConfig,
        cacheBackend: "indexeddb" as const,
        model_list: webllm.prebuiltAppConfig.model_list.map((model) =>
          model.model_id === LOCAL_LLM_MODEL
            ? {
                ...model,
                overrides: {
                  ...model.overrides,
                  // Reduce KV-cache memory on shared/integrated GPUs.
                  context_window_size: Math.min(model.overrides?.context_window_size ?? 4096, 2048),
                },
              }
            : model,
        ),
      };
      return webllm.CreateMLCEngine(LOCAL_LLM_MODEL, {
        appConfig,
        initProgressCallback: (report) => {
          scope.postMessage({
            id,
            type: "progress",
            progress: Number(report.progress ?? 0),
            text: typeof report.text === "string" ? report.text : "Loading local AI model…",
          });
        },
      });
    })().catch((error: unknown) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

function enqueue(operation: () => Promise<void>): void {
  operationQueue = operationQueue.then(operation, operation);
}

scope.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;

  if (request.type === "cancel") {
    if (activeGenerationId !== request.generationId) return;
    cancelledGenerations.add(request.generationId);
    void enginePromise
      ?.then((engine) => engine.interruptGenerate())
      .catch((error: unknown) => {
        scope.postMessage({
          id: request.generationId,
          type: "error",
          error: `Generation cancellation failed: ${errorText(error)}`,
        });
      });
    return;
  }

  if (request.type === "reset") {
    resetting = true;
    if (activeGenerationId !== null) {
      cancelledGenerations.add(activeGenerationId);
      void enginePromise?.then((engine) => engine.interruptGenerate()).catch(() => undefined);
    }
    enqueue(async () => {
      try {
        const engine = await enginePromise?.catch(() => null);
        enginePromise = null;
        if (engine) await engine.unload();
        scope.postMessage({ id: request.id, type: "reset" });
      } catch (error) {
        scope.postMessage({ id: request.id, type: "error", error: errorText(error) });
      } finally {
        resetting = false;
      }
    });
    return;
  }

  if (resetting) {
    scope.postMessage({ id: request.id, type: "error", error: "The local AI worker is resetting. Retry after reset completes." });
    return;
  }

  if (request.type === "generate") {
    if (generationPending) {
      scope.postMessage({ id: request.id, type: "error", error: "A local generation is already queued or running." });
      return;
    }
    generationPending = true;
  }

  enqueue(async () => {
    try {
      if (request.type === "init") {
        await getEngine(request.id);
        scope.postMessage({ id: request.id, type: "ready" });
        return;
      }
      activeGenerationId = request.id;
      const engine = await getEngine(request.id);
      const response = await engine.chat.completions.create({
        messages: request.messages,
        temperature: 0.2,
        top_p: 0.9,
        max_tokens: 192,
      });
      const content = response.choices?.[0]?.message?.content;
      if (cancelledGenerations.has(request.id)) {
        scope.postMessage({ id: request.id, type: "cancelled" });
      } else {
        scope.postMessage({ id: request.id, type: "result", text: typeof content === "string" ? content : "" });
      }
    } catch (error) {
      if (request.type === "generate" && cancelledGenerations.has(request.id)) {
        scope.postMessage({ id: request.id, type: "cancelled" });
      } else {
        scope.postMessage({ id: request.id, type: "error", error: errorText(error) });
      }
    } finally {
      if (request.type === "generate") {
        cancelledGenerations.delete(request.id);
        activeGenerationId = null;
        generationPending = false;
      }
    }
  });
};
