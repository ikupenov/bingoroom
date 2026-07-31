/* ---------------------------------------------------------------------------
 * Meeting Mode: listen to the call via the Web Speech API and stream the
 * transcript out so the caller can auto-mark spoken buzzwords.
 * Chrome / Edge only; degrades to `supported: false` elsewhere.
 * ------------------------------------------------------------------------- */

interface SRAlternative {
  transcript: string;
}
interface SRResult {
  0: SRAlternative;
  isFinal: boolean;
}
interface SRResultList {
  length: number;
  [index: number]: SRResult;
}
interface SREvent {
  resultIndex: number;
  results: SRResultList;
}
interface SRErrorEvent {
  error: string;
}
interface SRInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SRConstructor = new () => SRInstance;

function getConstructor(): SRConstructor | undefined {
  const g = globalThis as unknown as {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition;
}

export interface VoiceListener {
  supported: boolean;
  listening(): boolean;
  start(): void;
  stop(): void;
}

export interface VoiceHandlers {
  onTranscript: (text: string) => void;
  onState: (listening: boolean) => void;
  onError?: (error: string) => void;
}

export function createVoiceListener(handlers: VoiceHandlers): VoiceListener {
  const SR = getConstructor();
  if (!SR) {
    return { supported: false, listening: () => false, start() {}, stop() {} };
  }

  let rec: SRInstance | null = null;
  let active = false;

  const build = (): SRInstance => {
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        text += e.results[i]![0].transcript + " ";
      }
      handlers.onTranscript(text);
    };
    r.onerror = (e) => {
      // "no-speech" / "aborted" are routine — let onend auto-restart.
      if (e.error === "no-speech" || e.error === "aborted") return;
      // Anything else (network, service-not-allowed, not-allowed, audio-capture)
      // is fatal: stop the retry loop and report it.
      active = false;
      handlers.onError?.(e.error);
    };
    r.onend = () => {
      // The engine stops itself after a pause; restart while Meeting Mode is on.
      if (active) {
        try {
          r.start();
        } catch {
          active = false;
          handlers.onState(false);
        }
      } else {
        handlers.onState(false);
      }
    };
    return r;
  };

  return {
    supported: true,
    listening: () => active,
    start() {
      if (active) return;
      active = true;
      rec = build();
      try {
        rec.start();
        handlers.onState(true);
      } catch {
        active = false;
        handlers.onState(false);
      }
    },
    stop() {
      active = false;
      try {
        rec?.stop();
      } catch {
        /* already stopped */
      }
      handlers.onState(false);
    },
  };
}
