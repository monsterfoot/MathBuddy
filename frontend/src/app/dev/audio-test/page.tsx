"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAudioSession, type ThresholdOverrides } from "@/hooks/useAudioSession";
import { AUDIO, AUDIO_TEST } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function AudioTestPage() {
  // --- Demo selection ---
  const [demoId, setDemoId] = useState("demo_1");

  // --- Volume gate toggle + slider state ---
  const [gateEnabled, setGateEnabled] = useState(false); // start with gate OFF (original behavior)
  const [gateThreshold, setGateThreshold] = useState<number>(AUDIO.VOLUME_GATE_THRESHOLD);
  const [playbackThreshold, setPlaybackThreshold] = useState<number>(AUDIO.VOLUME_GATE_PLAYBACK_THRESHOLD);
  const [tailMs, setTailMs] = useState<number>(AUDIO.PLAYBACK_TAIL_MS);

  // When gate is off, override thresholds to 0 (send all audio)
  const effectiveGate = gateEnabled ? gateThreshold : 0;
  const effectivePb = gateEnabled ? playbackThreshold : 0;
  const effectiveTail = gateEnabled ? tailMs : 0;

  const gateRef = useRef(effectiveGate);
  const pbRef = useRef(effectivePb);
  const tailRef = useRef(effectiveTail);

  useEffect(() => { gateRef.current = effectiveGate; }, [effectiveGate]);
  useEffect(() => { pbRef.current = effectivePb; }, [effectivePb]);
  useEffect(() => { tailRef.current = effectiveTail; }, [effectiveTail]);

  const thresholdOverrides: ThresholdOverrides = {
    volumeGateThreshold: gateRef,
    volumeGatePlaybackThreshold: pbRef,
    playbackTailMs: tailRef,
  };

  // --- RMS data for meter (written by callback, read by RAF) ---
  const rmsDataRef = useRef({ rms: 0, threshold: 0, isPlaybackActive: false });
  const meterBarRef = useRef<HTMLDivElement>(null);
  const meterThresholdRef = useRef<HTMLDivElement>(null);
  const rmsLabelRef = useRef<HTMLSpanElement>(null);
  const thresholdLabelRef = useRef<HTMLSpanElement>(null);
  const pbIndicatorRef = useRef<HTMLSpanElement>(null);

  const onRmsUpdate = useCallback(
    (rms: number, threshold: number, isPlaybackActive: boolean) => {
      rmsDataRef.current = { rms, threshold, isPlaybackActive };
    },
    [],
  );

  // RAF loop for smooth meter updates (no React re-renders)
  useEffect(() => {
    let animId: number;
    const tick = () => {
      const { rms, threshold, isPlaybackActive } = rmsDataRef.current;
      const maxRms = AUDIO_TEST.RMS_METER_MAX;
      if (meterBarRef.current) {
        const pct = Math.min(rms / maxRms, 1) * 100;
        meterBarRef.current.style.width = `${pct}%`;
        meterBarRef.current.style.backgroundColor =
          rms >= threshold ? "#22c55e" : "#9ca3af";
      }
      if (meterThresholdRef.current) {
        const pct = Math.min(threshold / maxRms, 1) * 100;
        meterThresholdRef.current.style.left = `${pct}%`;
      }
      if (rmsLabelRef.current) {
        rmsLabelRef.current.textContent = rms.toFixed(4);
      }
      if (thresholdLabelRef.current) {
        thresholdLabelRef.current.textContent = threshold.toFixed(4);
      }
      if (pbIndicatorRef.current) {
        pbIndicatorRef.current.textContent = isPlaybackActive ? "PB" : "";
      }
      animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, []);

  // --- Audio session hook ---
  const {
    connected,
    recording,
    transcript,
    turnCount,
    coachingComplete,
    silentTooLong,
    interruptionCount,
    error: audioError,
    connect,
    disconnect,
    startRecording,
    clearTranscript,
  } = useAudioSession({
    attemptId: demoId,
    thresholdOverrides,
    onRmsUpdate,
  });

  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // --- Handlers ---
  const handleToggleSession = () => {
    if (connected) {
      disconnect();
    } else {
      connect();
      setTimeout(() => startRecording(), 1000);
    }
  };

  const handleDemoChange = (id: string) => {
    if (connected) disconnect();
    clearTranscript();
    setDemoId(id);
  };

  const handleResetDefaults = () => {
    setGateThreshold(AUDIO.VOLUME_GATE_THRESHOLD);
    setPlaybackThreshold(AUDIO.VOLUME_GATE_PLAYBACK_THRESHOLD);
    setTailMs(AUDIO.PLAYBACK_TAIL_MS);
  };

  const handleCopyValues = () => {
    if (!gateEnabled) return;
    const text = [
      `VOLUME_GATE_THRESHOLD: ${gateThreshold},`,
      `VOLUME_GATE_PLAYBACK_THRESHOLD: ${playbackThreshold},`,
      `PLAYBACK_TAIL_MS: ${tailMs},`,
    ].join("\n");
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Audio Test Lab</h1>
        <div className="flex gap-1">
          {AUDIO_TEST.DEMO_IDS.map((id) => (
            <button
              key={id}
              onClick={() => handleDemoChange(id)}
              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                demoId === id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {AUDIO_TEST.DEMO_LABELS[id] ?? id}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {audioError && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {audioError}
        </div>
      )}

      {/* RMS Meter */}
      <Card className="p-3">
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>RMS Meter</span>
          <span>
            RMS: <span ref={rmsLabelRef} className="font-mono">0.0000</span>
            {" | "}
            Thr: <span ref={thresholdLabelRef} className="font-mono">0.0000</span>
            {" "}
            <span ref={pbIndicatorRef} className="font-semibold text-orange-500" />
          </span>
        </div>
        <div className="relative h-6 overflow-hidden rounded-md bg-muted">
          {/* Bar */}
          <div
            ref={meterBarRef}
            className="absolute inset-y-0 left-0 transition-[width] duration-75"
            style={{ width: "0%", backgroundColor: "#9ca3af" }}
          />
          {/* Threshold line */}
          <div
            ref={meterThresholdRef}
            className="absolute inset-y-0 w-0.5 bg-red-500"
            style={{ left: "0%" }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>0</span>
          <span>{AUDIO_TEST.RMS_METER_MAX}</span>
        </div>
      </Card>

      {/* Stats */}
      <div className="flex flex-wrap gap-3 text-xs">
        <Stat label="Status" value={connected ? (recording ? "Recording" : "Connected") : "Disconnected"} />
        <Stat label="Turns" value={turnCount} />
        <Stat label="Interrupts" value={interruptionCount} highlight={interruptionCount > 0} />
        {coachingComplete && <Stat label="Coaching" value="Complete" />}
        {silentTooLong && <Stat label="Silent" value="Too long" highlight />}
      </div>

      {/* Sliders */}
      <Card className="space-y-3 p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Volume Gate</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setGateEnabled(!gateEnabled)}
              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                gateEnabled
                  ? "bg-green-100 text-green-700"
                  : "bg-red-100 text-red-700"
              }`}
            >
              {gateEnabled ? "ON" : "OFF (all audio)"}
            </button>
            {gateEnabled && (
              <Button variant="outline" size="sm" onClick={handleResetDefaults} className="h-6 text-xs">
                Reset
              </Button>
            )}
          </div>
        </div>
        {!gateEnabled && (
          <p className="text-[11px] text-muted-foreground">
            Gate OFF = 원래 프로세스와 동일 (모든 오디오 전송). ON으로 전환 후 임계값 조정.
          </p>
        )}
        {gateEnabled && (<>
          <SliderRow
            label="Gate Threshold"
            value={gateThreshold}
            onChange={setGateThreshold}
            min={AUDIO_TEST.THRESHOLD_MIN}
            max={AUDIO_TEST.THRESHOLD_MAX}
            step={AUDIO_TEST.THRESHOLD_STEP}
            defaultVal={AUDIO.VOLUME_GATE_THRESHOLD}
          />
          <SliderRow
            label="Playback Threshold"
            value={playbackThreshold}
            onChange={setPlaybackThreshold}
            min={AUDIO_TEST.PLAYBACK_THRESHOLD_MIN}
            max={AUDIO_TEST.PLAYBACK_THRESHOLD_MAX}
            step={AUDIO_TEST.PLAYBACK_THRESHOLD_STEP}
            defaultVal={AUDIO.VOLUME_GATE_PLAYBACK_THRESHOLD}
          />
          <SliderRow
            label="Tail MS"
            value={tailMs}
            onChange={setTailMs}
            min={AUDIO_TEST.TAIL_MS_MIN}
            max={AUDIO_TEST.TAIL_MS_MAX}
            step={AUDIO_TEST.TAIL_MS_STEP}
            defaultVal={AUDIO.PLAYBACK_TAIL_MS}
            formatValue={(v) => `${v}ms`}
          />
        </>)}
      </Card>

      {/* Transcript */}
      <Card className="flex max-h-64 flex-col overflow-hidden p-0">
        <div className="flex items-center justify-between border-b px-3 py-1.5">
          <span className="text-xs font-medium text-muted-foreground">Transcript</span>
          <button
            onClick={clearTranscript}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {transcript.length === 0 && (
            <p className="text-center text-xs text-muted-foreground">
              세션을 시작하면 대화가 여기에 표시됩니다.
            </p>
          )}
          <div className="space-y-2">
            {transcript.map((entry, i) => (
              <div
                key={i}
                className={`flex ${
                  entry.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-1.5 text-xs leading-relaxed ${
                    entry.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {entry.text}
                </div>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        </div>
      </Card>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <Button
          onClick={handleToggleSession}
          variant={connected ? "destructive" : "default"}
          className="flex-1"
        >
          {connected ? "Disconnect" : "Start Session"}
        </Button>
        <Button variant="outline" size="sm" onClick={handleCopyValues}>
          Copy Values
        </Button>
      </div>

      {/* Copy-ready values */}
      <pre className="rounded-md bg-muted p-2 text-[11px] text-muted-foreground">
{gateEnabled
  ? `VOLUME_GATE_THRESHOLD: ${gateThreshold},
VOLUME_GATE_PLAYBACK_THRESHOLD: ${playbackThreshold},
PLAYBACK_TAIL_MS: ${tailMs},`
  : `Gate OFF — all audio sent (original behavior)`}
      </pre>
    </div>
  );
}

// --- Sub-components ---

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string | number;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-md px-2 py-1 ${
        highlight ? "bg-orange-100 text-orange-700" : "bg-muted text-muted-foreground"
      }`}
    >
      <span className="font-medium">{label}:</span> {value}
    </div>
  );
}

function SliderRow({
  label,
  value,
  onChange,
  min,
  max,
  step,
  defaultVal,
  formatValue,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  defaultVal: number;
  formatValue?: (v: number) => string;
}) {
  const display = formatValue ? formatValue(value) : value.toString();
  const isDefault = value === defaultVal;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-mono ${isDefault ? "text-muted-foreground" : "font-semibold text-foreground"}`}>
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}
