export const LOCAL_LLM_MODEL = "Qwen3-0.6B-q4f16_1-MLC";

export type LocalLLMProgress = {
  progress: number;
  text: string;
};

export type LocalLLMOptions = {
  onProgress?: (progress: LocalLLMProgress) => void;
  onStage?: (stage: "loading" | "generating") => void;
};

export type LocalLLMMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type WorkerRequest =
  | { id: number; type: "init" }
  | { id: number; type: "generate"; messages: LocalLLMMessage[] }
  | { id: number; type: "reset" }
  | { id: number; type: "cancel"; generationId: number };
type WorkerCommand =
  | { type: "init" }
  | { type: "generate"; messages: LocalLLMMessage[] }
  | { type: "reset" }
  | { type: "cancel"; generationId: number };

type WorkerResponse =
  | { id: number; type: "progress"; progress: number; text: string }
  | { id: number; type: "result"; text: string }
  | { id: number; type: "cancelled" }
  | { id: number; type: "reset" }
  | { id: number; type: "ready" }
  | { id: number; type: "error"; error: string };

type PendingRequest = {
  resolve: (value: WorkerResponse) => void;
  reject: (error: Error) => void;
  onProgress?: LocalLLMOptions["onProgress"];
  worker: Worker;
  kind: WorkerCommand["type"];
  timeoutId?: ReturnType<typeof setTimeout>;
  cancelTimeoutId?: ReturnType<typeof setTimeout>;
  timedOut?: boolean;
};

const INITIALIZATION_TIMEOUT_MS = 10 * 60 * 1000;
const GENERATION_TIMEOUT_MS = 120 * 1000;
const CANCELLATION_GRACE_MS = 5 * 1000;
const RESET_GRACE_MS = 15 * 1000;

let worker: Worker | null = null;
let nextRequestId = 1;
let initialization: Promise<void> | null = null;
let activeGeneration: Promise<string> | null = null;
let workerResetPromise: Promise<void> | null = null;
let runtimeEpoch = 0;
const pending = new Map<number, PendingRequest>();

const HIDDEN_REASONING_TAG = "think|analysis|reasoning|reflection|scratchpad|chain[_ -]?of[_ -]?thought|cot|internal|deliberation";

function cleanLocalResponse(text: string): string {
  const hiddenTag = new RegExp(
    `<\\s*(${HIDDEN_REASONING_TAG})\\b[^>]*>[\\s\\S]*?(?:<\\s*\\/\\s*\\1\\s*>|$)`,
    "gi",
  );
  const hiddenToken = new RegExp(
    `<\\|(${HIDDEN_REASONING_TAG})\\|>[\\s\\S]*?(?:<\\|\\/\\1\\|>|$)`,
    "gi",
  );
  return text
    .replace(hiddenTag, "")
    .replace(hiddenToken, "")
    .replace(new RegExp(`<\\s*\\/?\\s*(?:${HIDDEN_REASONING_TAG})\\b[^>]*>`, "gi"), "")
    .replace(new RegExp(`<\\|\\/?(?:${HIDDEN_REASONING_TAG})\\|>`, "gi"), "")
    .replace(/<\|(?:im_start|im_end|fim_prefix|fim_middle|fim_suffix)\|>/gi, "")
    .replace(/<\/?(?:s|pad)>/gi, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function assertWebGPUSupport(): void {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) {
    throw new Error("WebGPU is not available in this browser/device.");
  }
  if (typeof Worker === "undefined") {
    throw new Error("Web Workers are not available in this browser.");
  }
}

function clearRequestTimers(request: PendingRequest): void {
  if (request.timeoutId) clearTimeout(request.timeoutId);
  if (request.cancelTimeoutId) clearTimeout(request.cancelTimeoutId);
}

function timeoutRequest(id: number, instance: Worker): void {
  const request = pending.get(id);
  if (!request || request.worker !== instance) return;
  request.timeoutId = undefined;

  if (request.kind !== "generate") {
    failWorker(instance, new Error("Local model initialization timed out. The worker was stopped and can be restarted."));
    return;
  }

  request.timedOut = true;
  try {
    instance.postMessage({
      id: nextRequestId++,
      type: "cancel",
      generationId: id,
    } satisfies WorkerRequest);
  } catch {
    failWorker(instance, new Error("Local generation timed out and the worker could not be cancelled."));
    return;
  }

  request.cancelTimeoutId = setTimeout(() => {
    failWorker(instance, new Error("Local generation did not stop after cancellation. The worker was terminated and can be restarted."));
  }, CANCELLATION_GRACE_MS);
}

function failWorker(instance: Worker, error: Error): void {
  if (worker !== instance) return;
  runtimeEpoch += 1;
  for (const [id, request] of pending) {
    if (request.worker === instance) {
      pending.delete(id);
      clearRequestTimers(request);
      request.reject(error);
    }
  }
  worker = null;
  initialization = null;
  activeGeneration = null;
  try {
    instance.terminate();
  } catch {
    // The failed worker is already unusable; the next explicit request creates a fresh one.
  }
}

function getWorker(): Worker {
  if (worker) return worker;
  const instance = new Worker(
    new URL("./webllm.worker.ts", import.meta.url),
    { type: "module", name: "wowmazing-webllm" },
  );
  instance.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (!message || typeof message.id !== "number" || typeof message.type !== "string") {
      failWorker(instance, new Error("The local AI worker returned an invalid response."));
      return;
    }
    const request = pending.get(message.id);
    if (!request || request.worker !== instance) return;
    if (message.type === "progress") {
      try {
        request.onProgress?.({ progress: message.progress, text: message.text });
      } catch {
        // Progress UI callbacks must not break worker message handling.
      }
    } else if (message.type === "error") {
      pending.delete(message.id);
      clearRequestTimers(request);
      request.reject(new Error(message.error));
    } else if (message.type === "cancelled") {
      pending.delete(message.id);
      clearRequestTimers(request);
      request.reject(new Error(
        request.timedOut
          ? "Local generation exceeded its two-minute limit and was cancelled."
          : "Local generation was cancelled.",
      ));
    } else {
      pending.delete(message.id);
      clearRequestTimers(request);
      if (request.timedOut) {
        request.reject(new Error("Local generation exceeded its two-minute limit and was cancelled."));
        return;
      }
      request.resolve(message);
    }
  };
  instance.onerror = (event) => {
    event.preventDefault();
    failWorker(instance, new Error(event.message || "The local AI worker failed."));
  };
  instance.onmessageerror = () => failWorker(instance, new Error("Could not read a response from the local AI worker."));
  worker = instance;
  return instance;
}

function requestWorker(
  request: WorkerCommand,
  onProgress?: LocalLLMOptions["onProgress"],
  timeoutMs?: number,
): Promise<WorkerResponse> {
  const epoch = runtimeEpoch;
  return (async () => {
    if (workerResetPromise) await workerResetPromise;
    if (epoch !== runtimeEpoch) throw new Error("Local AI was reset before the worker request started.");

    const id = nextRequestId++;
    return new Promise<WorkerResponse>((resolve, reject) => {
      try {
        const instance = getWorker();
        const pendingRequest: PendingRequest = {
          resolve,
          reject,
          onProgress,
          worker: instance,
          kind: request.type,
        };
        pending.set(id, pendingRequest);
        instance.postMessage({ ...request, id } as WorkerRequest);
        if (timeoutMs) {
          pendingRequest.timeoutId = setTimeout(() => timeoutRequest(id, instance), timeoutMs);
        }
      } catch (error) {
        const pendingRequest = pending.get(id);
        if (pendingRequest) clearRequestTimers(pendingRequest);
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  })();
}

/** Initializes the model in a dedicated worker and forwards download progress. */
export function initializeLocalLLM(options?: LocalLLMOptions): Promise<void> {
  if (initialization) return initialization;
  try {
    assertWebGPUSupport();
  } catch (error) {
    return Promise.reject(error);
  }
  const attempt = requestWorker(
    { type: "init" },
    options?.onProgress,
    INITIALIZATION_TIMEOUT_MS,
  )
    .then(() => undefined)
    .catch((error: unknown) => {
      if (initialization === attempt) initialization = null;
      throw error;
    });
  initialization = attempt;
  return attempt;
}

export function generateLocalText(
  messages: LocalLLMMessage[],
  options?: LocalLLMOptions,
): Promise<string> {
  if (activeGeneration) {
    return Promise.reject(new Error("A local generation is already running. Wait for it to finish before starting another."));
  }

  const epoch = runtimeEpoch;
  const operation = Promise.resolve().then(async () => {
    options?.onStage?.("loading");
    await initializeLocalLLM(options);
    if (epoch !== runtimeEpoch) throw new Error("Local AI was reset before generation started.");
    options?.onStage?.("generating");
    const response = await requestWorker(
      { type: "generate", messages },
      undefined,
      GENERATION_TIMEOUT_MS,
    );
    if (epoch !== runtimeEpoch) throw new Error("Local AI was reset during generation.");
    return response.type === "result" ? cleanLocalResponse(response.text) : "";
  });
  const trackedOperation = operation.finally(() => {
    if (activeGeneration === trackedOperation) activeGeneration = null;
  });
  activeGeneration = trackedOperation;
  return trackedOperation;
}

export function isLocalLLMAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator && typeof Worker !== "undefined";
}

export function resetLocalLLM(): Promise<void> {
  const previousWorker = worker;
  runtimeEpoch += 1;
  worker = null;
  initialization = null;
  activeGeneration = null;
  const error = new Error("Local AI was reset. A new worker will be created on the next explicit synthesis request.");
  for (const [id, request] of pending) {
    if (request.kind === "reset") continue;
    pending.delete(id);
    clearRequestTimers(request);
    request.reject(error);
  }
  if (!previousWorker) return workerResetPromise ?? Promise.resolve();

  let resolveReset!: () => void;
  const resetPromise = new Promise<void>((resolve) => {
    resolveReset = resolve;
  });
  workerResetPromise = resetPromise;

  const resetId = nextRequestId++;
  let completed = false;
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  const finishReset = () => {
    if (completed) return;
    completed = true;
    if (resetTimer) clearTimeout(resetTimer);
    const pendingReset = pending.get(resetId);
    if (pendingReset) {
      pending.delete(resetId);
      clearRequestTimers(pendingReset);
    }
    previousWorker.onmessage = null;
    previousWorker.onerror = null;
    previousWorker.onmessageerror = null;
    try {
      previousWorker.terminate();
    } catch {
      // The old worker is no longer current; requests wait for this barrier before restart.
    }
    if (workerResetPromise === resetPromise) workerResetPromise = null;
    resolveReset();
  };

  pending.set(resetId, {
    worker: previousWorker,
    kind: "reset",
    resolve: () => finishReset(),
    reject: () => finishReset(),
  });
  previousWorker.onerror = (event) => {
    event.preventDefault();
    finishReset();
  };
  previousWorker.onmessageerror = finishReset;
  resetTimer = setTimeout(finishReset, RESET_GRACE_MS);
  try {
    previousWorker.postMessage({ id: resetId, type: "reset" } satisfies WorkerRequest);
  } catch {
    finishReset();
  }
  return resetPromise;
}
