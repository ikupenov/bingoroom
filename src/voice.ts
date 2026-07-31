/* ---------------------------------------------------------------------------
 * Meeting Mode — on-device speech, works in every browser (incl. Dia).
 *
 * The whisper model (~40MB) is downloaded lazily the first time the user turns
 * Meeting Mode on, with progress reported for a UI bar. Audio is captured in
 * ~3s windows, resampled to 16kHz, and transcribed in a Web Worker; the text
 * is streamed back so the caller can auto-mark spoken buzzwords.
 * ------------------------------------------------------------------------- */

export interface VoiceCallbacks {
  onLoadingChange: (loading: boolean) => void;
  onProgress: (pct: number) => void;
  onListening: (on: boolean) => void;
  onTranscript: (text: string) => void;
  onError: (code: string) => void;
}

export interface MeetingVoice {
  toggle: () => void;
  listening: () => boolean;
  loading: () => boolean;
}

const TARGET_RATE = 16000;
const WINDOW_SEC = 3;

interface WorkerMessage {
  type: "progress" | "ready" | "result" | "error";
  pct?: number;
  text?: string;
  error?: string;
}

export function createMeetingVoice(cb: VoiceCallbacks): MeetingVoice {
  let worker: Worker | null = null;
  let modelReady = false;
  let loadingModel = false;
  let listeningNow = false;
  let readyResolve: (() => void) | null = null;
  let readyReject: ((e: string) => void) | null = null;

  // audio graph
  let stream: MediaStream | null = null;
  let audioCtx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let chunks: Float32Array[] = [];
  let chunkLen = 0;
  let busy = false;

  function ensureWorker(): void {
    if (worker) return;
    worker = new Worker(new URL("./whisper-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      switch (m.type) {
        case "progress":
          cb.onProgress(m.pct ?? 0);
          break;
        case "ready":
          modelReady = true;
          loadingModel = false;
          cb.onLoadingChange(false);
          readyResolve?.();
          readyResolve = readyReject = null;
          break;
        case "result":
          busy = false;
          if (m.text && m.text.trim()) cb.onTranscript(m.text);
          break;
        case "error":
          busy = false;
          if (!modelReady) {
            loadingModel = false;
            cb.onLoadingChange(false);
            readyReject?.(m.error ?? "load-failed");
            readyResolve = readyReject = null;
          }
          cb.onError(m.error ?? "error");
          break;
      }
    };
    worker.onerror = () => cb.onError("worker-failed");
  }

  function ensureModel(): Promise<void> {
    if (modelReady) return Promise.resolve();
    ensureWorker();
    loadingModel = true;
    cb.onLoadingChange(true);
    cb.onProgress(0);
    worker!.postMessage({ type: "load" });
    return new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
  }

  function flatten(): Float32Array {
    const out = new Float32Array(chunkLen);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }

  function resample(data: Float32Array, from: number): Float32Array {
    if (from === TARGET_RATE) return data;
    const ratio = from / TARGET_RATE;
    const outLen = Math.round(data.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const idx = i * ratio;
      const i0 = Math.floor(idx);
      const i1 = Math.min(i0 + 1, data.length - 1);
      const frac = idx - i0;
      out[i] = data[i0]! * (1 - frac) + data[i1]! * frac;
    }
    return out;
  }

  async function startListening(): Promise<void> {
    try {
      await ensureModel();
    } catch {
      return; // load error already reported
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      cb.onError("mic-denied");
      return;
    }

    audioCtx = new AudioContext({ sampleRate: TARGET_RATE });
    const rate = audioCtx.sampleRate;
    const windowSamples = TARGET_RATE * WINDOW_SEC;
    source = audioCtx.createMediaStreamSource(stream);
    processor = audioCtx.createScriptProcessor(4096, 1, 1);
    chunks = [];
    chunkLen = 0;

    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      const input = e.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(input));
      chunkLen += input.length;
      if (chunkLen < windowSamples) return;

      const audio = resample(flatten(), rate);
      chunks = [];
      chunkLen = 0;
      // Drop windows while the worker is busy so latency stays bounded.
      if (!busy && worker) {
        busy = true;
        worker.postMessage({ type: "transcribe", audio }, [audio.buffer]);
      }
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);
    listeningNow = true;
    cb.onListening(true);
  }

  function stopListening(): void {
    listeningNow = false;
    try {
      processor?.disconnect();
      source?.disconnect();
    } catch {
      /* already gone */
    }
    processor = null;
    source = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    void audioCtx?.close().catch(() => {});
    audioCtx = null;
    chunks = [];
    chunkLen = 0;
    busy = false;
    cb.onListening(false);
  }

  return {
    toggle() {
      if (listeningNow) stopListening();
      else if (!loadingModel) void startListening();
    },
    listening: () => listeningNow,
    loading: () => loadingModel,
  };
}
