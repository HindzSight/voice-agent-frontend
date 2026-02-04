import { Room, RoomEvent, Track } from "livekit-client";
import type { Participant, TrackPublication, TranscriptionSegment } from "livekit-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createToken } from "./api/token";

type LogEntry = { id: string; message: string; type: "info" | "success" | "error" };

type ToolCallEntry = {
  id: string;
  name: string;
  args?: Record<string, unknown> | string;
  result?: Record<string, unknown> | string;
  timestamp: string;
};

type TranscriptEntry = {
  id: string;
  speaker: string;
  text: string;
  timestamp: string;
};

const DEFAULT_LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL || "";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

function formatTime(date = new Date()) {
  return date.toLocaleTimeString();
}

export default function App() {
  const room = useMemo(() => new Room(), []);
  const audioRef = useRef<HTMLDivElement | null>(null);
  const avatarVideoRef = useRef<HTMLDivElement | null>(null);

  const [livekitUrl] = useState(DEFAULT_LIVEKIT_URL);
  const [status, setStatus] = useState<"disconnected" | "connecting" | "connected">(
    "disconnected"
  );
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallEntry[]>([]);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [summary, setSummary] = useState<string>("");
  const [cost, setCost] = useState<any>(null); // { total, breakdown: { stt, tts, llm, duration_seconds, tts_characters } }
  const [tokenBusy, setTokenBusy] = useState(false);
  const lastTranscriptRef = useRef<Record<string, string>>({});
  const [agentReady, setAgentReady] = useState(false);
  const [avatarActive, setAvatarActive] = useState(false);

  const log = (message: string, type: LogEntry["type"] = "info") => {
    setLogs((prev) => [
      ...prev,
      { id: crypto.randomUUID(), message, type },
    ]);
  };

  useEffect(() => {
    const handleConnected = () => {
      setStatus("connected");
      setAgentReady(false);
      log("Connected to room", "success");
    };

    const handleDisconnected = () => {
      setStatus("disconnected");
      setAgentReady(false);
      log("Disconnected from room", "error");
    };

    const handleParticipantConnected = (participant: { identity: string }) => {
      log(`Participant joined: ${participant.identity}`, "info");
    };

    const handleTrackSubscribed = (
      track: Track,
      _publication: unknown,
      participant: Participant
    ) => {
      if (track.kind === Track.Kind.Audio && audioRef.current) {
        const element = track.attach();
        element.setAttribute("data-track", participant.identity);
        audioRef.current.appendChild(element);
        log(`Audio attached from ${participant.identity}`, "success");
        if (participant.identity.startsWith("agent-")) {
          setAgentReady(true);
        }
      }

      if (track.kind === Track.Kind.Video && avatarVideoRef.current) {
        const isAvatarWorker = Boolean(participant.attributes?.["lk.publish_on_behalf"]);

        if (isAvatarWorker) {
          const element = track.attach();
          element.className = "avatar-video";
          element.setAttribute("data-track", participant.identity);
          avatarVideoRef.current.replaceChildren(element);
          setAvatarActive(true);
          log(`Avatar video attached from ${participant.identity}`, "success");
        }
      }
    };

    const handleTrackUnsubscribed = (
      track: Track,
      _publication: unknown,
      participant: Participant
    ) => {
      if (track.kind === Track.Kind.Audio) {
        track.detach().forEach((el) => el.remove());
        log(`Audio detached from ${participant.identity}`, "info");
      }

      if (track.kind === Track.Kind.Video) {
        track.detach().forEach((el) => el.remove());
        if (participant.attributes?.["lk.publish_on_behalf"]) {
          avatarVideoRef.current?.replaceChildren();
          setAvatarActive(false);
          log(`Avatar video detached from ${participant.identity}`, "info");
        }
      }
    };

    const handleData = (payload: Uint8Array) => {
      try {
        const text = new TextDecoder().decode(payload);
        const data = JSON.parse(text);
        if (data.type === "tool_call") {
          setToolCalls((prev) => [
            {
              id: crypto.randomUUID(),
              name: data.name || "unknown",
              args: data.args,
              result: data.result,
              timestamp: formatTime(),
            },
            ...prev,
          ]);
          return;
        }
        if (data.type === "summary") {
          setSummary(data.text || "");
          if (data.cost_breakdown) {
            setCost(data.cost_breakdown);
          }
          return;
        }
        if (data.type === "agent_ready") {
          setAgentReady(true);
          log("Agent is ready to talk", "success");
          return;
        }
        if (data.type === "call_end") {
          log("Call ended by agent", "info");
          room.disconnect();
          setStatus("disconnected");
          setAgentReady(false);
          return;
        }
      } catch (_error) {
        log("Received data message", "info");
      }
    };

    const handleTranscription = (
      segments: TranscriptionSegment[],
      participant?: Participant,
      _publication?: TrackPublication
    ) => {
      const speaker = participant?.identity ?? "user";
      if (!segments.length) return;

      const hasNonFinal = segments.some((s) => s.final === false);
      if (hasNonFinal) return;

      const text = segments.map((s) => s.text).join(" ").trim();
      if (!text) return;

      const lastText = lastTranscriptRef.current[speaker];
      if (lastText === text) return;
      lastTranscriptRef.current[speaker] = text;

      if (speaker.startsWith("agent-")) {
        setAgentReady(true);
      }

      setTranscripts((prev) => {
        const [latest, ...rest] = prev;
        if (latest && latest.speaker === speaker) {
          return [
            {
              ...latest,
              text,
              timestamp: formatTime(),
            },
            ...rest,
          ];
        }
        return [
          {
            id: crypto.randomUUID(),
            speaker,
            text,
            timestamp: formatTime(),
          },
          ...prev,
        ];
      });
    };

    room.on(RoomEvent.Connected, handleConnected);
    room.on(RoomEvent.Disconnected, handleDisconnected);
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
    room.on(RoomEvent.DataReceived, handleData);
    room.on(RoomEvent.TranscriptionReceived, handleTranscription);

    return () => {
      room.off(RoomEvent.Connected, handleConnected);
      room.off(RoomEvent.Disconnected, handleDisconnected);
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
      room.off(RoomEvent.DataReceived, handleData);
      room.off(RoomEvent.TranscriptionReceived, handleTranscription);
    };
  }, [room]);

  const connect = async () => {
    if (!livekitUrl) {
      log("Missing LiveKit URL", "error");
      return;
    }
    try {
      setTokenBusy(true);
      setStatus("connecting");
      log("Generating access token...", "info");
      const tokenResponse = await createToken(API_BASE_URL || window.location.origin, livekitUrl);
      log("Token generated. Connecting to LiveKit...", "success");
      await room.connect(livekitUrl, tokenResponse.token);
      await room.localParticipant.setMicrophoneEnabled(true);
      log("Microphone enabled", "success");
    } catch (error) {
      setStatus("disconnected");
      log(`Connection error: ${(error as Error).message}`, "error");
    } finally {
      setTokenBusy(false);
    }
  };


  const disconnect = async () => {
    await room.disconnect();
    setStatus("disconnected");
  };

  return (
    <div className="app-container">
      <div className="viewport">
        <div className="main-stage">
          <header className="header">
            <div>
              <p className="eyebrow">Voice Agent</p>
              <h1>Talk to an AI appointment agent</h1>
            </div>
            <div className={`status-pill ${status}`}>
              {status === "connected"
                ? agentReady
                  ? "Live"
                  : "Warming up"
                : status === "connecting"
                  ? "Connecting"
                  : "Offline"}
            </div>
          </header>

          <div className="avatar-section">
            <div className="avatar-wrapper">
              <div className="avatar-video-slot" ref={avatarVideoRef} />
              {!avatarActive && (
                <div className="avatar-static">
                  <img
                    src="https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&fit=facearea&w=300&h=300"
                    alt="Static avatar"
                  />
                  <div>
                    <h3>Beyond Presence</h3>
                    <p>Wait for the avatar to connect...</p>
                  </div>
                </div>
              )}
            </div>

            <div className="controls">
              <button
                className="primary"
                onClick={connect}
                disabled={status !== "disconnected" || tokenBusy}
              >
                {tokenBusy ? "Connecting..." : "Call Agent"}
              </button>
              <button className="secondary" onClick={disconnect} disabled={status !== "connected"}>
                End call
              </button>
            </div>
          </div>

          <div className="details-section">
            <section className="card">
              <h2>Call Summary</h2>
              {summary ? <p>{summary}</p> : <p className="muted">Summary will appear when the call ends.</p>}

              {cost && (
                <div style={{ marginTop: "16px", paddingTop: "16px", borderTop: "1px solid #e2e8f0" }}>
                  <h3>Session Cost Estimate</h3>
                  <p style={{ fontSize: "24px", fontWeight: "600", color: "#166534", margin: "8px 0" }}>
                    ${cost.total?.toFixed(5)}
                  </p>
                  <div style={{ fontSize: "13px", color: "#64748b", display: "grid", gap: "4px" }}>
                    <div>STT (Deepgram): ${cost.breakdown?.stt?.toFixed(5)} <span style={{ opacity: 0.7 }}>({cost.breakdown?.duration_seconds}s)</span></div>
                    <div>TTS (Cartesia): ${cost.breakdown?.tts?.toFixed(5)} <span style={{ opacity: 0.7 }}>({cost.breakdown?.tts_characters} chars)</span></div>
                    <div>LLM (Ollama): ${cost.breakdown?.llm?.toFixed(2)}</div>
                  </div>
                </div>
              )}
            </section>

            <section className="card">
              <h2>Live Logs</h2>
              <div className="list">
                {logs.length === 0 ? (
                  <p className="muted">Logs will appear here during connection and calls.</p>
                ) : (
                  logs.map((entry) => (
                    <div key={entry.id} className={`log ${entry.type}`}>
                      {entry.message}
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>

        <div className="side-stage">
          <div className="console-header">
            <h2>Agent Screen</h2>
            <p className="muted">Transcripts + tool calls appear here with timestamps.</p>
          </div>
          <div className="console">
            {[
              ...toolCalls.map((tool) => ({
                id: tool.id,
                type: "tool",
                timestamp: tool.timestamp,
                label: tool.name,
                body: {
                  args: tool.args,
                  result: tool.result,
                },
              })),
              ...transcripts.map((entry) => ({
                id: entry.id,
                type: "transcript",
                timestamp: entry.timestamp,
                label: entry.speaker,
                body: entry.text,
              })),
            ]
              .sort((a, b) => (a.timestamp > b.timestamp ? -1 : 1))
              .map((item) => (
                <div key={item.id} className={`console-line ${item.type}`}>
                  <div className="console-meta">
                    <span>{item.timestamp}</span>
                    <span>{item.type === "tool" ? "Tool Call" : "Transcript"}</span>
                  </div>
                  {item.type === "tool" ? (
                    <div className="tool-card">
                      <div className="tool-title">{item.label}</div>
                      <div className="tool-body">
                        {typeof item.body !== "string" && item.body.args && (
                          <div>
                            <div className="tool-label">Args</div>
                            <pre>{JSON.stringify(item.body.args, null, 2)}</pre>
                          </div>
                        )}
                        {typeof item.body !== "string" && item.body.result && (
                          <div>
                            <div className="tool-label">Result</div>
                            <pre>{JSON.stringify(item.body.result, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="transcript-text">
                      <span className="transcript-speaker">{item.label}: </span>
                      {item.body as string}
                    </p>
                  )}
                </div>
              ))}
          </div>
        </div>
      </div>

      <div className="hidden-audio" ref={audioRef} />
    </div>
  );
}
