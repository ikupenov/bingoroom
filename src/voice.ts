/* ---------------------------------------------------------------------------
 * Meeting Mode — on-device speech, works in every browser (incl. Dia).
 *
 * The whisper model (~40MB) is downloaded lazily the first time the user turns
 * Meeting Mode on, with progress reported for a UI bar. Audio is segmented by
 * voice activity (accumulate while speaking, transcribe on a pause), resampled
 * to 16kHz, and transcribed in a Web Worker; the text is streamed back so the
 * caller can auto-mark spoken buzzwords.
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
// Voice-activity segmentation: accumulate while you speak, transcribe the whole
// phrase when you pause. Whisper is far more accurate on complete utterances
// than on arbitrary fixed-length slices.
const SPEECH_ENTER_RMS = 0.006; // level that starts an utterance
const SPEECH_EXIT_RMS = 0.0035; // below this counts as silence (hysteresis)
const SILENCE_HANG_MS = 600; // trailing silence that ends an utterance
const MIN_SEG_MS = 250; // ignore blips shorter than this
const MAX_SEG_MS = 10000; // force a cut for long monologues
const PREROLL_MS = 250; // audio kept before onset so the first word isn't clipped
const FRAME_SIZE = 2048; // ~128ms at 16kHz -> fine-grained VAD

interface WorkerMessage {
  type: "progress" | "ready" | "result" | "error";
  pct?: number;
  text?: string;
  error?: string;
  device?: string;
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
  let busy = false;
  const queue: Float32Array[] = []; // utterances waiting for the worker

  // VAD state
  let speaking = false;
  let seg: Float32Array[] = [];
  let segLen = 0;
  let silenceSamples = 0;
  let preroll: Float32Array[] = [];
  let prerollLen = 0;

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
          console.info(`[voice] Meeting Mode ready (${m.device ?? "?"})`);
          cb.onLoadingChange(false);
          readyResolve?.();
          readyResolve = readyReject = null;
          break;
        case "result":
          busy = false;
          if (m.text && m.text.trim()) {
            console.debug("[voice] heard:", JSON.stringify(m.text.trim()));
            cb.onTranscript(m.text);
          }
          pump();
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
          pump();
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

  function flatten(parts: Float32Array[], length: number): Float32Array {
    const out = new Float32Array(length);
    let off = 0;
    for (const c of parts) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }

  function rms(data: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i]! * data[i]!;
    return Math.sqrt(sum / Math.max(1, data.length));
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

  // Send the next queued utterance if the worker is free.
  function pump(): void {
    if (busy || !worker || queue.length === 0) return;
    const audio = queue.shift()!;
    busy = true;
    worker.postMessage({ type: "transcribe", audio }, [audio.buffer]);
  }

  function enqueue(utterance: Float32Array, rate: number): void {
    const audio = resample(utterance, rate);
    queue.push(audio);
    while (queue.length > 3) queue.shift(); // bound backlog
    pump();
  }

  function resetVad(): void {
    speaking = false;
    seg = [];
    segLen = 0;
    silenceSamples = 0;
    preroll = [];
    prerollLen = 0;
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
    const hangSamples = (SILENCE_HANG_MS / 1000) * rate;
    const minSegSamples = (MIN_SEG_MS / 1000) * rate;
    const maxSegSamples = (MAX_SEG_MS / 1000) * rate;
    const prerollSamples = (PREROLL_MS / 1000) * rate;
    source = audioCtx.createMediaStreamSource(stream);
    processor = audioCtx.createScriptProcessor(FRAME_SIZE, 1, 1);
    resetVad();

    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      const frame = new Float32Array(e.inputBuffer.getChannelData(0));
      const level = rms(frame);

      if (!speaking) {
        preroll.push(frame);
        prerollLen += frame.length;
        while (prerollLen > prerollSamples && preroll.length > 1) {
          prerollLen -= preroll.shift()!.length;
        }
        if (level >= SPEECH_ENTER_RMS) {
          speaking = true;
          seg = preroll.slice();
          segLen = prerollLen;
          preroll = [];
          prerollLen = 0;
          silenceSamples = 0;
        }
        return;
      }

      // Speaking: accumulate until a pause (or the hard cap).
      seg.push(frame);
      segLen += frame.length;
      if (level >= SPEECH_EXIT_RMS) silenceSamples = 0;
      else silenceSamples += frame.length;

      if (silenceSamples >= hangSamples || segLen >= maxSegSamples) {
        const utterance = flatten(seg, segLen);
        const enough = segLen >= minSegSamples;
        resetVad();
        if (enough) enqueue(utterance, rate);
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
    queue.length = 0;
    resetVad();
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
