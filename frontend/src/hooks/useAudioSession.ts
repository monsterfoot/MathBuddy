"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getWsBaseUrl, AUDIO, COACHING } from "@/lib/constants";
import { fetchCoachingTicket } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { useLocale } from "next-intl";
import { useTranslations } from "next-intl";
import type { TranscriptEntry } from "@/types";

/** Runtime-adjustable threshold overrides for the volume gate. */
export interface ThresholdOverrides {
  volumeGateThreshold: { current: number };
  volumeGatePlaybackThreshold: { current: number };
  playbackTailMs: { current: number };
}

interface UseAudioSessionOptions {
  attemptId: string;
  retry?: boolean;
  variantContext?: {
    display_text: string;
    correct_answer: string;
    student_answer: string;
  } | null;
  onCoachingComplete?: (turnCount: number) => void;
  onTurnComplete?: (turnCount: number) => void;
  /** Optional threshold overrides — pass refs that update in real-time. */
  thresholdOverrides?: ThresholdOverrides;
  /** Fires on every audio frame with RMS info — use for visualisation (not React state). */
  onRmsUpdate?: (rms: number, threshold: number, isPlaybackActive: boolean) => void;
}

export type AgentState = "idle" | "listening" | "thinking" | "speaking";

interface UseAudioSessionReturn {
  connected: boolean;
  recording: boolean;
  transcript: TranscriptEntry[];
  turnCount: number;
  coachingComplete: boolean;
  silentTooLong: boolean;
  interruptionCount: number;
  agentState: AgentState;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  sendText: (text: string) => void;
  clearTranscript: () => void;
}

/**
 * Hook for managing a real-time voice coaching session.
 *
 * Handles:
 * - WebSocket connection to backend
 * - Microphone capture at 16kHz PCM mono via AudioWorklet/ScriptProcessor
 * - Playback of 24kHz PCM audio from server
 * - Transcript accumulation from server events
 */
export function useAudioSession({
  attemptId,
  retry = false,
  variantContext,
  onCoachingComplete,
  onTurnComplete,
  thresholdOverrides,
  onRmsUpdate,
}: UseAudioSessionOptions): UseAudioSessionReturn {
  const t = useTranslations("coach");
  const locale = useLocale();
  const [connected, setConnected] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [coachingComplete, setCoachingComplete] = useState(false);
  const [silentTooLong, setSilentTooLong] = useState(false);
  const [interruptionCount, setInterruptionCount] = useState(0);
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [error, setError] = useState<string | null>(null);

  // Track when user last spoke (timestamp, for thinking vs listening distinction)
  const userLastSpokeRef = useRef(0);

  // Keep callbacks in refs to avoid re-creating the connect function
  const onCoachingCompleteRef = useRef(onCoachingComplete);
  const onTurnCompleteRef = useRef(onTurnComplete);
  onCoachingCompleteRef.current = onCoachingComplete;
  onTurnCompleteRef.current = onTurnComplete;

  // Threshold overrides + RMS callback refs (updated every render, read in onaudioprocess)
  const thresholdOverridesRef = useRef(thresholdOverrides);
  thresholdOverridesRef.current = thresholdOverrides;
  const onRmsUpdateRef = useRef(onRmsUpdate);
  onRmsUpdateRef.current = onRmsUpdate;

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // Playback queue: buffer incoming audio chunks
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);

  // Volume gate: track AI playback to apply adaptive threshold
  const lastPlaybackTimeRef = useRef(0);

  // Silence detection: track last agent activity
  const lastAgentActivityRef = useRef(0);
  const silenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keepalive timer: prevent backend inactivity timeout when volume gate filters silence
  const keepaliveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Playback: enqueue PCM chunks as AudioBuffers ---
  const playAudioChunk = useCallback((pcmData: ArrayBuffer) => {
    if (!playbackCtxRef.current) {
      playbackCtxRef.current = new AudioContext({
        sampleRate: AUDIO.OUTPUT_SAMPLE_RATE,
      });
    }
    const ctx = playbackCtxRef.current;
    const int16 = new Int16Array(pcmData);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const buffer = ctx.createBuffer(1, float32.length, AUDIO.OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startTime = Math.max(now, nextPlayTimeRef.current);
    source.start(startTime);
    nextPlayTimeRef.current = startTime + buffer.duration;

    // Track when AI audio is playing for volume gate
    lastPlaybackTimeRef.current = Date.now();
    source.onended = () => {
      lastPlaybackTimeRef.current = Date.now();
    };

  }, []);

  // --- WebSocket connection ---
  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // Obtain short-lived coaching ticket (keeps Firebase token out of URL)
    let ticket: string;
    try {
      ticket = await fetchCoachingTicket();
    } catch {
      setError("Failed to obtain coaching ticket");
      return;
    }

    let wsUrl = `${getWsBaseUrl()}/ws/coach?attempt_id=${attemptId}&retry=${retry}`;
    wsUrl += `&ticket=${encodeURIComponent(ticket)}`;
    wsUrl += `&locale=${encodeURIComponent(locale)}`;
    if (variantContext) {
      wsUrl += `&variant_text=${encodeURIComponent(variantContext.display_text)}`;
      wsUrl += `&variant_answer=${encodeURIComponent(variantContext.correct_answer)}`;
      wsUrl += `&variant_student_answer=${encodeURIComponent(variantContext.student_answer)}`;
    }
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      setConnected(true);
      setInterruptionCount(0);
      lastAgentActivityRef.current = Date.now();
      setSilentTooLong(false);
      // Start silence detection timer
      if (silenceTimerRef.current) clearInterval(silenceTimerRef.current);
      silenceTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - lastAgentActivityRef.current;
        if (elapsed > COACHING.SILENCE_TIMEOUT_MS) {
          setSilentTooLong(true);
        }
      }, 3000);
      // Start keepalive to prevent backend inactivity timeout
      if (keepaliveTimerRef.current) clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 30_000);
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // Binary = PCM audio from server
        lastAgentActivityRef.current = Date.now();
        setSilentTooLong(false);
        setAgentState("speaking");
        playAudioChunk(event.data);
      } else {
        // Text = JSON control message
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "transcript") {
            const role = msg.role as "user" | "agent";
            const finished = !!msg.finished;

            if (role === "agent") {
              lastAgentActivityRef.current = Date.now();
              setSilentTooLong(false);
            }
            setTranscript((prev) => {
              const lastIdx = prev.length - 1;
              const last = lastIdx >= 0 ? prev[lastIdx] : null;
              if (last && last.role === role && !last.finished) {
                const updated = [...prev];
                updated[lastIdx] = {
                  role,
                  text: finished ? msg.text : last.text + msg.text,
                  timestamp: Date.now(),
                  finished,
                };
                return updated;
              }
              return [
                ...prev,
                { role, text: msg.text, timestamp: Date.now(), finished },
              ];
            });
          } else if (msg.type === "turn_complete") {
            const tc = msg.turn_count ?? 0;
            setTurnCount(tc);
            setAgentState("idle");
            onTurnCompleteRef.current?.(tc);
          } else if (msg.type === "coaching_complete") {
            const tc = msg.turn_count ?? 0;
            setCoachingComplete(true);
            setTurnCount(tc);
            onCoachingCompleteRef.current?.(tc);
          } else if (msg.type === "interrupted") {
            setInterruptionCount((prev) => prev + 1);
          } else if (msg.type === "status" && msg.message === "connected") {
            setTranscript((prev) => [
              ...prev,
              {
                role: "agent",
                text: t("sessionStarted"),
                timestamp: Date.now(),
              },
            ]);
          }
        } catch {
          // Ignore unparseable messages
        }
      }
    };

    ws.onclose = () => {
      setConnected(false);
      setRecording(false);
      if (silenceTimerRef.current) {
        clearInterval(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      if (keepaliveTimerRef.current) {
        clearInterval(keepaliveTimerRef.current);
        keepaliveTimerRef.current = null;
      }
    };

    ws.onerror = () => {
      setConnected(false);
    };

    wsRef.current = ws;
  }, [attemptId, retry, variantContext, playAudioChunk, locale]);

  // --- Mic capture: getUserMedia → ScriptProcessorNode → PCM → WebSocket ---
  const startRecording = useCallback(async () => {
    if (recording || !wsRef.current) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      const msg =
        location.protocol === "https:" || location.hostname === "localhost"
          ? t("micNotAvailable")
          : t("httpsRequired");
      setError(msg);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: AUDIO.INPUT_SAMPLE_RATE,
          channelCount: AUDIO.CHANNELS,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // Resume playback context if suspended (iOS requirement)
      if (playbackCtxRef.current?.state === "suspended") {
        await playbackCtxRef.current.resume();
      }

      const audioCtx = new AudioContext({ sampleRate: AUDIO.INPUT_SAMPLE_RATE });
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;

      // ScriptProcessorNode (deprecated but widely supported; AudioWorklet needs a separate file)
      const bufferSize = 4096;
      const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);

        // Volume gate: compute RMS and skip quiet frames (echo/silence)
        let sumSq = 0;
        for (let i = 0; i < input.length; i++) {
          sumSq += input[i] * input[i];
        }
        const rms = Math.sqrt(sumSq / input.length);

        // Use higher threshold during/shortly after AI playback
        const msSincePlayback = Date.now() - lastPlaybackTimeRef.current;
        const overrides = thresholdOverridesRef.current;
        const tailMs = overrides?.playbackTailMs.current ?? AUDIO.PLAYBACK_TAIL_MS;
        const isPlaybackActive = msSincePlayback < tailMs;
        const threshold = isPlaybackActive
          ? (overrides?.volumeGatePlaybackThreshold.current ?? AUDIO.VOLUME_GATE_PLAYBACK_THRESHOLD)
          : (overrides?.volumeGateThreshold.current ?? AUDIO.VOLUME_GATE_THRESHOLD);

        // Fire RMS callback for visualization (before gate check)
        onRmsUpdateRef.current?.(rms, threshold, isPlaybackActive);

        if (rms < threshold) return; // skip — too quiet (likely echo or silence)

        // Mark when user is sending audio (for thinking vs listening distinction)
        userLastSpokeRef.current = Date.now();

        // Convert Float32 → Int16 PCM
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        wsRef.current.send(pcm.buffer);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      setRecording(true);
    } catch (err) {
      console.error("Failed to start recording:", err);
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setError(t("micDenied"));
      } else {
        setError(t("micError"));
      }
    }
  }, [recording]);

  // --- Stop mic ---
  const stopRecording = useCallback(() => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    audioCtxRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());

    processorRef.current = null;
    sourceRef.current = null;
    audioCtxRef.current = null;
    streamRef.current = null;

    // Reset voice timestamp so agent state goes to idle (not "thinking")
    userLastSpokeRef.current = 0;

    setRecording(false);
  }, []);

  // --- Disconnect everything ---
  const disconnect = useCallback(() => {
    stopRecording();
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: "end" }));
      wsRef.current.close();
      wsRef.current = null;
    }
    playbackCtxRef.current?.close();
    playbackCtxRef.current = null;
    nextPlayTimeRef.current = 0;
    if (silenceTimerRef.current) {
      clearInterval(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (keepaliveTimerRef.current) {
      clearInterval(keepaliveTimerRef.current);
      keepaliveTimerRef.current = null;
    }
    setConnected(false);
  }, [stopRecording]);

  // --- Clear transcript ---
  const clearTranscript = useCallback(() => {
    setTranscript([]);
  }, []);

  // --- Send text message ---
  const sendText = useCallback((text: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "text", text }));
    userLastSpokeRef.current = Date.now();
    setTranscript((prev) => [
      ...prev,
      { role: "user", text, timestamp: Date.now(), finished: true },
    ]);
    setAgentState("thinking");
  }, []);

  // Agent state derivation: poll timing refs to determine speaking/thinking/listening/idle
  useEffect(() => {
    if (!connected) {
      setAgentState("idle");
      return;
    }
    const interval = setInterval(() => {
      const now = Date.now();
      const msSincePlayback = now - lastPlaybackTimeRef.current;
      const msSinceUserSpoke = now - userLastSpokeRef.current;
      // Speaking: agent audio played within last 500ms
      if (msSincePlayback < 500) {
        setAgentState("speaking");
        return;
      }
      // Listening: user is actively talking (audio within last 1s)
      if (recording && userLastSpokeRef.current > 0 && msSinceUserSpoke < 1000) {
        setAgentState("listening");
        return;
      }
      // Thinking: user spoke after agent's last response, waiting for reply
      if (userLastSpokeRef.current > lastPlaybackTimeRef.current && userLastSpokeRef.current > 0) {
        setAgentState("thinking");
        return;
      }
      // Listening: mic is on, waiting for user to speak
      if (recording) {
        setAgentState("listening");
        return;
      }
      setAgentState("idle");
    }, 200);
    return () => clearInterval(interval);
  }, [connected, recording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close();
      playbackCtxRef.current?.close();
      wsRef.current?.close();
      if (silenceTimerRef.current) clearInterval(silenceTimerRef.current);
      if (keepaliveTimerRef.current) clearInterval(keepaliveTimerRef.current);
    };
  }, []);

  return {
    connected,
    recording,
    transcript,
    turnCount,
    coachingComplete,
    silentTooLong,
    interruptionCount,
    agentState,
    error,
    connect,
    disconnect,
    startRecording,
    stopRecording,
    sendText,
    clearTranscript,
  };
}
