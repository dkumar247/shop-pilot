"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useCallback, useMemo, useRef, useState } from "react";

type Mode = "chat" | "agent";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function MessagePart({
  part,
  messageId,
  index,
}: {
  part: UIMessage["parts"][number];
  messageId: string;
  index: number;
}) {
  if (part.type === "text") {
    return (
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{part.text}</p>
    );
  }

  if (part.type === "file" && part.mediaType?.startsWith("image/")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={part.url}
        alt={part.filename ?? "Uploaded image"}
        className="mt-2 max-h-48 rounded-lg border border-zinc-800 object-contain"
      />
    );
  }

  if (part.type.startsWith("tool-")) {
    const label = part.type.replace("tool-", "");
    const state = "state" in part ? part.state : "unknown";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const output = (part as any).output as Record<string, Record<string, unknown>> | undefined;

    return (
      <div
        key={`${messageId}-tool-${index}`}
        className="mt-2 rounded-lg border border-[#FF5C28]/30 bg-[rgb(255_92_40/0.12)] px-3 py-2 text-xs"
      >
        <div className="font-medium text-[#FF5C28]">Tool: {label}</div>
        <div className="mt-1 text-zinc-400">
          {state === "input-available" && "Calling…"}
          {state === "output-error" && "Error"}
          {state === "output-available" && label === "parseShoppingRequest" && output ? (
            <div className="mt-2 space-y-2">
              {Object.entries(output).map(([item, attrs]) => (
                <div key={item}>
                  <span className="font-semibold capitalize text-white">{item}</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {Object.entries(attrs).map(([k, v]) =>
                      v !== undefined && v !== null && v !== "" ? (
                        <span
                          key={k}
                          className="rounded-full border border-[#FF5C28]/50 bg-zinc-900 px-2 py-0.5 text-zinc-300"
                        >
                          {k}: <span className="text-white">{String(v)}</span>
                        </span>
                      ) : null
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            state === "output-available" && "Done"
          )}
        </div>
      </div>
    );
  }

  return null;
}

type CartSummary = {
  items?: Array<{ name: string; price: string }>;
  total?: string;
  name?: string;
  price?: string;
};

function extractCartSummary(messages: UIMessage[]): CartSummary | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    for (const part of msg.parts) {
      if (
        part.type.includes("getCartSummary") &&
        "state" in part &&
        part.state === "output-available" &&
        "output" in part
      ) {
        return (part as unknown as { output: CartSummary }).output;
      }
    }
  }
  return null;
}

function CartSummaryCard({ summary }: { summary: CartSummary }) {
  const name = summary.name ?? summary.items?.[0]?.name ?? "Item";
  const price = summary.price ?? summary.items?.[0]?.price ?? summary.total ?? "";

  return (
    <div className="mt-4 rounded-2xl border border-[#FF5C28] bg-zinc-950 p-5 shadow-lg shadow-[#FF5C28]/10">
      <p className="text-xs font-medium uppercase tracking-wider text-[#FF5C28]">
        Added to cart
      </p>
      <p className="mt-2 text-2xl font-semibold text-white">{name}</p>
      {price && (
        <p className="mt-1 text-xl font-medium text-[#22c55e]">{price}</p>
      )}
      {summary.total && summary.items && (
        <p className="mt-1 text-sm text-zinc-400">
          Order total: {summary.total}
        </p>
      )}
      <a
        href="https://www.wayfair.com/checkout/cart"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-block rounded-xl bg-[#FF5C28] px-5 py-2.5 text-sm font-semibold text-black hover:bg-[#ff7347]"
      >
        View cart on Wayfair →
      </a>
    </div>
  );
}

type MicStatus = "idle" | "recording-sr" | "recording-mr" | "processing";

export function ChatApp() {
  const [mode, setMode] = useState<Mode>("agent");
  const [input, setInput] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [micStatus, setMicStatus] = useState<MicStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [micError, setMicError] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const sentRef = useRef(false);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: { mode: "agent" },
      }),
    [],
  );

  const { messages, sendMessage, status, error, stop } = useChat({ transport });
  const isBusy = status === "streaming" || status === "submitted";
  const cartSummary = extractCartSummary(messages);

  const sendTranscript = useCallback(
    (text: string) => {
      if (sentRef.current) return;
      sentRef.current = true;
      setTranscript(text);
      sendMessage({ parts: [{ type: "text", text }] });
      setTimeout(() => { sentRef.current = false; }, 2000);
    },
    [sendMessage],
  );

  const startSpeechRecognition = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    setMicStatus("recording-sr");
    setMicError("");
    setTranscript("");
    recognitionRef.current = recognition;

    let accumulated = "";

    recognition.onresult = (event: { results: { length: number; [key: number]: { isFinal: boolean; [key: number]: { transcript: string } } } }) => {
      accumulated = "";
      for (let i = 0; i < event.results.length; i++) {
        accumulated += event.results[i][0].transcript;
      }
      // show live transcript as user speaks
      setTranscript(accumulated);
    };
    recognition.onerror = (e: { error: string }) => {
      recognitionRef.current = null;
      setMicStatus("idle");
      if (e.error !== "no-speech") {
        setMicError(`Mic error: ${e.error}. Try the text input instead.`);
      }
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setMicStatus("idle");
      if (accumulated.trim()) {
        sendTranscript(accumulated.trim());
      } else {
        setMicError("No speech detected. Try again or use the text input.");
      }
    };
    recognition.start();
  }, [sendTranscript]);

  const startMediaRecorder = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setMicStatus("processing");

      try {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });

        const uploadRes = await fetch("/api/upload-audio", {
          method: "POST",
          headers: { "Content-Type": "audio/webm" },
          body: blob,
        });
        const { key, error: uploadErr } = await uploadRes.json() as { key?: string; error?: string };
        if (!key) throw new Error(uploadErr ?? "Upload failed");

        const transcribeRes = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key }),
        });
        const { transcript: text, fallback } = await transcribeRes.json() as { transcript: string; fallback?: boolean };

        setMicStatus("idle");
        if (!fallback && text) sendTranscript(text);
      } catch {
        setMicStatus("idle");
      }
    };

    mediaRecorderRef.current = recorder;
    recorder.start();
    setMicStatus("recording-mr");
  }, [sendTranscript]);

  const handleMicClick = useCallback(async () => {
    if (micStatus === "recording-sr") {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setMicStatus("idle");
      return;
    }

    // MediaRecorder needs a manual stop click
    if (micStatus === "recording-mr") {
      mediaRecorderRef.current?.stop();
      return;
    }

    if (micStatus === "processing" || isBusy) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasSR = !!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition;
    if (hasSR) {
      startSpeechRecognition();
    } else {
      await startMediaRecorder();
    }
  }, [micStatus, isBusy, startSpeechRecognition, startMediaRecorder]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text && !imageFile) return;

    const parts: Array<
      | { type: "text"; text: string }
      | { type: "file"; mediaType: string; url: string; filename?: string }
    > = [];

    if (imageFile) {
      parts.push({
        type: "file",
        mediaType: imageFile.type || "image/png",
        url: await fileToDataUrl(imageFile),
        filename: imageFile.name,
      });
    }
    if (text) parts.push({ type: "text", text });

    sendMessage({ parts });
    setInput("");
    setImageFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="flex min-h-full flex-col bg-black">
      <header className="border-b border-zinc-800 bg-black">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-[#FF5C28]">
              Wayfair Hack
            </p>
            <h1 className="text-xl font-semibold tracking-tight text-white">
              Wayfair Shopping Agent
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              Speak your request. Agent shops Wayfair. Item lands in your cart.
            </p>
          </div>

          <div className="flex rounded-full border border-zinc-800 bg-zinc-950 p-1">
            <button
              type="button"
              onClick={() => setMode("chat")}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                mode === "chat"
                  ? "bg-[#FF5C28] text-black"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Chat
            </button>
            <button
              type="button"
              onClick={() => setMode("agent")}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                mode === "agent"
                  ? "bg-[#FF5C28] text-black"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Agent
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6">
        {/* message list */}
        <div className="flex-1 space-y-4 overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
          {messages.length === 0 && (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center text-center text-zinc-500">
              <p className="text-lg font-medium text-zinc-200">
                Click the mic and say:
              </p>
              <p className="mt-3 text-sm text-zinc-400">
                &ldquo;I want a blue mid-century sofa under $700&rdquo;
              </p>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  message.role === "user"
                    ? "bg-[#FF5C28] text-black"
                    : "border border-zinc-800 bg-zinc-900 text-zinc-100"
                }`}
              >
                <div
                  className={`mb-1 text-xs font-medium uppercase tracking-wide ${
                    message.role === "user" ? "text-black/60" : "text-[#FF5C28]"
                  }`}
                >
                  {message.role}
                </div>
                {message.parts.map((part, index) => (
                  <MessagePart
                    key={`${message.id}-${index}`}
                    part={part}
                    messageId={message.id}
                    index={index}
                  />
                ))}
              </div>
            </div>
          ))}

          {isBusy && (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#FF5C28]" />
              Agent shopping on Wayfair…
            </div>
          )}
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-sm text-red-400">
            {error.message}
          </p>
        )}

        {/* cart summary card */}
        {cartSummary && <CartSummaryCard summary={cartSummary} />}

        {/* mic section */}
        <div className="mt-6 flex flex-col items-center gap-3">
          {/* transcript pill */}
          {transcript && (
            <p className="rounded-full border border-zinc-700 bg-zinc-900 px-4 py-1.5 text-sm text-zinc-300">
              Heard: <span className="text-white">{transcript}</span>
            </p>
          )}

          {/* mic button */}
          <div className="relative flex items-center justify-center">
            {(micStatus === "recording-sr" || micStatus === "recording-mr") && (
              <span className="absolute inline-flex h-24 w-24 animate-ping rounded-full bg-[#FF5C28] opacity-20" />
            )}
            <button
              type="button"
              onClick={handleMicClick}
              disabled={micStatus === "processing" || isBusy}
              className={`relative flex h-20 w-20 items-center justify-center rounded-full text-3xl shadow-lg transition-all ${
                micStatus === "recording-sr"
                  ? "bg-red-600 hover:bg-red-700"
                  : micStatus === "recording-mr"
                    ? "bg-red-600 hover:bg-red-700"
                    : micStatus === "processing" || isBusy
                      ? "cursor-not-allowed bg-zinc-700"
                      : "bg-[#FF5C28] hover:bg-[#ff7347]"
              }`}
              title={
                micStatus === "recording-sr" ? "Listening… speak now"
                : micStatus === "recording-mr" ? "Click to stop"
                : "Start recording"
              }
            >
              {micStatus === "recording-sr" || micStatus === "recording-mr" ? "⏹" : micStatus === "processing" ? "⏳" : "🎙"}
            </button>
          </div>

          <p className="text-xs text-zinc-500">
            {micStatus === "recording-sr" && "Listening… speak then click stop or pause naturally"}
            {micStatus === "recording-mr" && "Recording… click to stop"}
            {micStatus === "processing" && "Transcribing…"}
            {micStatus === "idle" && !isBusy && "Click mic to speak your request"}
            {isBusy && micStatus === "idle" && "Agent is running…"}
          </p>
          {micError && (
            <p className="text-xs text-red-400">{micError}</p>
          )}

          {/* text input toggle */}
          <button
            type="button"
            onClick={() => setShowTextInput((v) => !v)}
            className="text-xs text-zinc-600 underline hover:text-zinc-400"
          >
            {showTextInput ? "Hide text input" : "or type instead"}
          </button>

          {showTextInput && (
            <form onSubmit={handleSubmit} className="w-full space-y-2">
              {imageFile && (
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <span>
                    Image: <span className="text-[#FF5C28]">{imageFile.name}</span>
                  </span>
                  <button
                    type="button"
                    className="text-[#FF5C28] hover:underline"
                    onClick={() => {
                      setImageFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setImageFile(file);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-medium text-zinc-200 hover:border-[#FF5C28] hover:text-[#FF5C28]"
                >
                  Image
                </button>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Describe what furniture you want…"
                  className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-[#FF5C28] focus:ring-2 focus:ring-[#FF5C28]/30"
                  disabled={isBusy}
                />
                {isBusy ? (
                  <button
                    type="button"
                    onClick={() => stop()}
                    className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-[#FF5C28]"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!input.trim() && !imageFile}
                    className="rounded-xl bg-[#FF5C28] px-4 py-2 text-sm font-medium text-black hover:bg-[#ff7347] disabled:opacity-40"
                  >
                    Send
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
