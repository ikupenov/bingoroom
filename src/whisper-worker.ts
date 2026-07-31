/* ---------------------------------------------------------------------------
 * Web Worker: runs whisper-tiny.en fully on-device (WebGPU, WASM fallback).
 * Keeps the model download + inference off the main thread.
 *
 * Messages in:  { type: "load" } | { type: "transcribe", audio: Float32Array }
 * Messages out: { type: "progress", pct } | { type: "ready" }
 *               | { type: "result", text } | { type: "error", error }
 * ------------------------------------------------------------------------- */
import { env, pipeline } from "@huggingface/transformers";

// We only ever pull the model from the Hugging Face CDN.
env.allowLocalModels = false;

const MODEL = "Xenova/whisper-tiny.en";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Transcriber = any;
let transcriber: Transcriber | null = null;
let loading = false;

// Aggregate per-file download progress into a single percentage.
const files: Record<string, { loaded: number; total: number }> = {};
function overallPct(): number {
  let loaded = 0;
  let total = 0;
  for (const k in files) {
    loaded += files[k]!.loaded;
    total += files[k]!.total;
  }
  return total > 0 ? Math.round((loaded / total) * 100) : 0;
}

function hasWebGPU(): boolean {
  try {
    return "gpu" in navigator && Boolean((navigator as unknown as { gpu?: unknown }).gpu);
  } catch {
    return false;
  }
}

async function load(): Promise<void> {
  if (transcriber || loading) return;
  loading = true;
  try {
    const device = hasWebGPU() ? "webgpu" : "wasm";
    transcriber = await pipeline("automatic-speech-recognition", MODEL, {
      device,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      progress_callback: (p: any) => {
        if (p?.status === "progress" && p.file) {
          files[p.file] = { loaded: p.loaded ?? 0, total: p.total ?? 0 };
          self.postMessage({ type: "progress", pct: overallPct() });
        }
      },
    });
    self.postMessage({ type: "ready" });
  } catch (err) {
    self.postMessage({ type: "error", error: String(err) });
  } finally {
    loading = false;
  }
}

async function transcribe(audio: Float32Array): Promise<void> {
  if (!transcriber) return;
  try {
    const out = await transcriber(audio);
    const text = Array.isArray(out)
      ? out.map((o: { text?: string }) => o.text ?? "").join(" ")
      : (out?.text ?? "");
    self.postMessage({ type: "result", text });
  } catch (err) {
    self.postMessage({ type: "error", error: String(err) });
  }
}

self.onmessage = (e: MessageEvent): void => {
  const msg = e.data as { type: string; audio?: Float32Array };
  if (msg.type === "load") void load();
  else if (msg.type === "transcribe" && msg.audio) void transcribe(msg.audio);
};
