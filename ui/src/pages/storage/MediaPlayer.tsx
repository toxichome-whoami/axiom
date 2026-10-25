/*
 * Axiom High-Performance Universal Media Player & Preview Engine.
 * Supports: Video (streaming, seek, speed, PiP, fullscreen), Audio, Image (zoom/pan), PDF, Code/Text, and Binary.
 * Clean, high-performance industrial design (zero AI slop, no cartoonish colors).
 * Owned by: ui/pages/storage
 * Dependencies: lucide-react, ./format, ./fileIcon
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Copy,
  Check,
  Download,
  AlertCircle,
  FileCode,
  FileText,
} from "lucide-react";
import { formatBytes } from "./format";
import { getFileIcon, getFileExtension } from "./fileIcon";

export interface MediaPlayerProps {
  url: string;
  name: string;
  contentType?: string;
  size?: number;
  downloadUrl?: string;
  onDownload?: () => void;
  className?: string;
  autoPlay?: boolean;
  hideHeader?: boolean;
}

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || !isFinite(seconds) || seconds < 0) return "00:00";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function MediaPlayer({
  url,
  name,
  contentType,
  size,
  downloadUrl,
  onDownload,
  className = "",
  autoPlay = false,
  hideHeader = false,
}: MediaPlayerProps) {
  const ext = name.split(".").pop()?.toLowerCase() || "";

  // Classify media kind
  const isVideo =
    ["mp4", "webm", "mov", "mkv", "m4v", "ogv"].includes(ext) ||
    Boolean(contentType?.startsWith("video/"));

  const isAudio =
    ["mp3", "wav", "ogg", "flac", "aac", "m4a", "opus"].includes(ext) ||
    Boolean(contentType?.startsWith("audio/"));

  const isImage =
    ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"].includes(
      ext,
    ) || Boolean(contentType?.startsWith("image/"));

  const isPdf = ext === "pdf" || contentType === "application/pdf";

  const isCodeOrText =
    [
      "txt",
      "json",
      "csv",
      "tsv",
      "log",
      "md",
      "rs",
      "ts",
      "tsx",
      "js",
      "jsx",
      "py",
      "sql",
      "toml",
      "yaml",
      "yml",
      "xml",
      "html",
      "css",
      "sh",
      "env",
      "diff",
      "patch",
    ].includes(ext) ||
    Boolean(contentType?.startsWith("text/")) ||
    contentType === "application/json";

  // ─────────────────────────────────────────────────────────────
  // 1. VIDEO PLAYER STATE & HANDLERS
  // ─────────────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const controlsTimeoutRef = useRef<number | null>(null);

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      window.clearTimeout(controlsTimeoutRef.current);
    }
    if (isPlaying) {
      controlsTimeoutRef.current = window.setTimeout(() => {
        setShowControls(false);
        setShowSpeedMenu(false);
      }, 2500);
    }
  };

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch((err) => {
        console.warn("Playback error:", err);
      });
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    setCurrentTime(videoRef.current.currentTime);
    if (videoRef.current.buffered.length > 0) {
      setBufferedEnd(
        videoRef.current.buffered.end(videoRef.current.buffered.length - 1),
      );
    }
  };

  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    setDuration(videoRef.current.duration || 0);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
      setIsMuted(val === 0);
    }
  };

  const handleSpeedSelect = (rate: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
      setPlaybackRate(rate);
      setShowSpeedMenu(false);
    }
  };

  const toggleFullscreen = () => {
    if (!videoContainerRef.current) return;
    if (!document.fullscreenElement) {
      videoContainerRef.current.requestFullscreen().catch((err) => {
        console.warn("Fullscreen error:", err);
      });
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch((err) => {
        console.warn("Exit fullscreen error:", err);
      });
      setIsFullscreen(false);
    }
  };

  // Keyboard Shortcuts for video
  useEffect(() => {
    if (!isVideo) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        ["input", "textarea"].includes(
          (e.target as HTMLElement).tagName.toLowerCase(),
        )
      ) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "KeyF") {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.code === "KeyM") {
        e.preventDefault();
        toggleMute();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        if (videoRef.current) videoRef.current.currentTime += 5;
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        if (videoRef.current) videoRef.current.currentTime -= 5;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isVideo, togglePlay]);

  // ─────────────────────────────────────────────────────────────
  // 2. AUDIO PLAYER STATE & HANDLERS
  // ─────────────────────────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioVolume, setAudioVolume] = useState(1);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isAudioLoop, setIsAudioLoop] = useState(false);

  const toggleAudioPlay = () => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      audioRef.current.play().catch(console.warn);
      setIsAudioPlaying(true);
    } else {
      audioRef.current.pause();
      setIsAudioPlaying(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 3. IMAGE VIEWER STATE, WHEEL ZOOM & PAN/DRAG
  // ─────────────────────────────────────────────────────────────
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [imgNaturalSize, setImgNaturalSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const imgViewportRef = useRef<HTMLDivElement | null>(null);
  const dragStartPosRef = useRef({ x: 0, y: 0, startPanX: 0, startPanY: 0 });

  // Reset zoom & pan when image url changes
  useEffect(() => {
    setZoomLevel(1);
    setPanPosition({ x: 0, y: 0 });
    setIsDraggingImage(false);
  }, [url]);

  // Wheel zoom
  useEffect(() => {
    const el = imgViewportRef.current;
    if (!el || !isImage) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.2 : -0.2;
      setZoomLevel((prev) => {
        const next = Math.round((prev + delta) * 100) / 100;
        return Math.min(Math.max(0.25, next), 6.0);
      });
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [isImage]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Only primary mouse button
    if ((e.target as HTMLElement).closest("button")) return; // Ignore toolbar buttons
    e.preventDefault();
    setIsDraggingImage(true);
    dragStartPosRef.current = {
      x: e.clientX,
      y: e.clientY,
      startPanX: panPosition.x,
      startPanY: panPosition.y,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignored
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingImage) return;
    const dx = e.clientX - dragStartPosRef.current.x;
    const dy = e.clientY - dragStartPosRef.current.y;
    setPanPosition({
      x: Math.round(dragStartPosRef.current.startPanX + dx),
      y: Math.round(dragStartPosRef.current.startPanY + dy),
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingImage) return;
    setIsDraggingImage(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignored
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 4. CODE & TEXT PREVIEW
  // ─────────────────────────────────────────────────────────────
  const [textContent, setTextContent] = useState<string | null>(null);
  const [isLoadingText, setIsLoadingText] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    if (isCodeOrText && url) {
      setIsLoadingText(true);
      setTextError(null);
      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.text();
        })
        .then((txt) => {
          if (txt.length > 500_000) {
            setTextContent(
              txt.slice(0, 500_000) +
                "\n\n... [Truncated for browser performance]",
            );
          } else {
            setTextContent(txt);
          }
        })
        .catch((err) => {
          setTextError(
            err instanceof Error ? err.message : "Failed to load text preview",
          );
        })
        .finally(() => {
          setIsLoadingText(false);
        });
    }
  }, [isCodeOrText, url]);

  const handleCopyText = () => {
    if (!textContent) return;
    navigator.clipboard.writeText(textContent);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // ─────────────────────────────────────────────────────────────
  // RENDER: VIDEO
  // ─────────────────────────────────────────────────────────────
  if (isVideo) {
    const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
    const bufferedPercent = duration > 0 ? (bufferedEnd / duration) * 100 : 0;

    return (
      <div
        ref={videoContainerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => isPlaying && setShowControls(false)}
        className={`relative flex flex-col items-center justify-center bg-[#09090b] rounded-[8px] overflow-hidden border border-[#222222] group select-none ${className} ${
          isFullscreen ? "w-screen h-screen rounded-none border-none" : "w-full"
        }`}
      >
        {videoError ? (
          <div className="p-8 text-center max-w-md space-y-3 font-sans">
            <AlertCircle className="w-8 h-8 text-amber-400 mx-auto" />
            <h4 className="text-white text-[15px] font-medium">
              Unable to decode video in browser
            </h4>
            <p className="text-[13px] text-[#8c8c8c] leading-relaxed">
              This video container or codec may not be natively supported by
              your web browser. You can download the file directly to play it
              locally.
            </p>
            {onDownload && (
              <button
                type="button"
                onClick={onDownload}
                className="mt-2 inline-flex items-center gap-2 h-8 px-3 rounded-[6px] bg-white text-black font-medium text-[13px] hover:bg-[#e0e0e0] transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" /> Download Video (
                {formatBytes(size || 0)})
              </button>
            )}
          </div>
        ) : (
          <>
            {/* The Video Element */}
            <div
              className="relative w-full flex items-center justify-center bg-black cursor-pointer"
              style={{ maxHeight: isFullscreen ? "100vh" : "72vh" }}
              onClick={togglePlay}
              onDoubleClick={toggleFullscreen}
            >
              <video
                ref={videoRef}
                src={url}
                autoPlay={autoPlay}
                playsInline
                preload="metadata"
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onError={() => setVideoError("Error decoding video")}
                className="max-h-[72vh] w-auto max-w-full object-contain mx-auto"
                style={{ maxHeight: isFullscreen ? "100vh" : "72vh" }}
              />

              {/* Minimal Center Play Indicator when paused */}
              {!isPlaying && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20">
                  <div className="w-12 h-12 rounded-full bg-white/10 border border-white/20 backdrop-blur-xs flex items-center justify-center text-white shadow-xl">
                    <Play className="w-5 h-5 fill-white translate-x-0.5" />
                  </div>
                </div>
              )}
            </div>

            {/* Custom Control Bar */}
            <div
              className={`absolute bottom-0 left-0 right-0 p-3 pt-4 bg-[#0a0a0a]/90 backdrop-blur-xs border-t border-[#1f1f1f] transition-opacity duration-200 font-sans z-20 ${
                showControls ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
            >
              {/* Timeline Scrubber */}
              <div className="relative group/seeker w-full h-1.5 mb-2.5 flex items-center cursor-pointer">
                <div className="w-full h-1 bg-[#262626] rounded-full overflow-hidden relative">
                  {/* Buffer bar */}
                  <div
                    className="absolute top-0 bottom-0 left-0 bg-[#383838] rounded-full"
                    style={{ width: `${bufferedPercent}%` }}
                  />
                  {/* Progress bar */}
                  <div
                    className="absolute top-0 bottom-0 left-0 bg-white rounded-full"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                {/* HTML range input over timeline */}
                <input
                  type="range"
                  min={0}
                  max={duration || 100}
                  step={0.1}
                  value={currentTime}
                  onChange={handleSeek}
                  aria-label="Seek video timeline"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </div>

              {/* Controls Row */}
              <div className="flex items-center justify-between text-white text-[13px]">
                {/* Left Controls: Play, Time, Volume */}
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={togglePlay}
                    title={isPlaying ? "Pause (Space)" : "Play (Space)"}
                    className="w-7 h-7 rounded-[4px] flex items-center justify-center hover:bg-[#222222] transition-colors cursor-pointer text-white"
                  >
                    {isPlaying ? (
                      <Pause className="w-3.5 h-3.5 fill-white" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-white translate-x-0.5" />
                    )}
                  </button>

                  {/* Time Counter */}
                  <div className="text-[13.5px] font-sans font-medium text-[#cccccc] tabular-nums">
                    <span>{formatDuration(currentTime)}</span>
                    <span className="text-[#555555] mx-1">/</span>
                    <span className="text-[#888888]">
                      {formatDuration(duration)}
                    </span>
                  </div>

                  {/* Volume Slider */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={toggleMute}
                      title={isMuted ? "Unmute (M)" : "Mute (M)"}
                      className="w-7 h-7 rounded-[4px] flex items-center justify-center hover:bg-[#222222] transition-colors cursor-pointer text-[#cccccc] hover:text-white"
                    >
                      {isMuted || volume === 0 ? (
                        <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                      ) : (
                        <Volume2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={isMuted ? 0 : volume}
                      onChange={handleVolumeChange}
                      aria-label="Adjust volume"
                      className="w-16 h-1 bg-[#262626] rounded-full appearance-none accent-white cursor-pointer transition-all"
                    />
                  </div>
                </div>

                {/* Right Controls: Speed, Fullscreen, Download */}
                <div className="flex items-center gap-1.5 relative">
                  {/* Speed Selector */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowSpeedMenu((prev) => !prev)}
                      title="Playback Speed"
                      className="h-7 px-2.5 rounded-[4px] hover:bg-[#222222] transition-colors text-[13.5px] font-sans font-medium text-[#cccccc] hover:text-white flex items-center gap-1 cursor-pointer"
                    >
                      <span>{playbackRate}x</span>
                    </button>

                    {showSpeedMenu && (
                      <div className="absolute bottom-8 right-0 bg-[#141414] border border-[#262626] rounded-[6px] shadow-2xl p-1 w-20 z-30 font-sans space-y-0.5">
                        {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                          <button
                            key={rate}
                            type="button"
                            onClick={() => handleSpeedSelect(rate)}
                            className={`w-full text-left px-2 py-1 rounded-[4px] text-[13px] font-sans font-medium transition-colors cursor-pointer flex items-center justify-between ${
                              playbackRate === rate
                                ? "bg-white text-black font-semibold"
                                : "text-[#cccccc] hover:bg-[#222222]"
                            }`}
                          >
                            <span>{rate}x</span>
                            {playbackRate === rate && (
                              <Check className="w-3 h-3 stroke-[3]" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {onDownload && (
                    <button
                      type="button"
                      onClick={onDownload}
                      title="Download file"
                      className="w-7 h-7 rounded-[4px] flex items-center justify-center hover:bg-[#222222] transition-colors cursor-pointer text-[#cccccc] hover:text-white"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    title={
                      isFullscreen ? "Exit Fullscreen (F)" : "Fullscreen (F)"
                    }
                    className="w-7 h-7 rounded-[4px] flex items-center justify-center hover:bg-[#222222] transition-colors cursor-pointer text-[#cccccc] hover:text-white"
                  >
                    {isFullscreen ? (
                      <Minimize className="w-3.5 h-3.5" />
                    ) : (
                      <Maximize className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER: AUDIO (Clean Monochrome, No Cartoonish Colors)
  // ─────────────────────────────────────────────────────────────
  if (isAudio) {
    const audioProgress =
      audioDuration > 0 ? (audioCurrentTime / audioDuration) * 100 : 0;

    return (
      <div
        className={`p-6 bg-[#0c0c0c] border border-[#222222] rounded-[8px] flex flex-col items-center max-w-xl mx-auto shadow-2xl font-sans ${className}`}
      >
        <audio
          ref={audioRef}
          src={url}
          autoPlay={autoPlay}
          loop={isAudioLoop}
          onTimeUpdate={() =>
            audioRef.current &&
            setAudioCurrentTime(audioRef.current.currentTime)
          }
          onLoadedMetadata={() =>
            audioRef.current && setAudioDuration(audioRef.current.duration || 0)
          }
          onPlay={() => setIsAudioPlaying(true)}
          onPause={() => setIsAudioPlaying(false)}
        />

        {/* Clean Monochrome Audio Card */}
        <div className="w-16 h-16 rounded-[8px] bg-[#141414] border border-[#262626] flex items-center justify-center mb-3 text-white">
          <div className="flex items-center gap-1 h-6">
            <span
              className={`w-1 bg-[#8c8c8c] rounded-full transition-all duration-300 ${isAudioPlaying ? "h-5" : "h-2"}`}
            />
            <span
              className={`w-1 bg-white rounded-full transition-all duration-200 ${isAudioPlaying ? "h-6" : "h-3"}`}
            />
            <span
              className={`w-1 bg-[#cccccc] rounded-full transition-all duration-300 ${isAudioPlaying ? "h-4" : "h-2"}`}
            />
            <span
              className={`w-1 bg-white rounded-full transition-all duration-150 ${isAudioPlaying ? "h-5" : "h-3"}`}
            />
          </div>
        </div>

        <h3 className="text-white text-[16px] font-sans font-semibold truncate max-w-full text-center">
          {name}
        </h3>
        <p className="text-[13.5px] text-[#8c8c8c] font-sans font-normal mt-1 mb-4">
          {getFileExtension(name)} &bull; {formatBytes(size || 0)}
        </p>

        {/* Timeline */}
        <div className="w-full space-y-1 mb-4">
          <div className="relative group w-full h-2 flex items-center cursor-pointer">
            <div className="w-full h-1 bg-[#222222] rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-all"
                style={{ width: `${audioProgress}%` }}
              />
            </div>
            <input
              type="range"
              min={0}
              max={audioDuration || 100}
              step={0.1}
              value={audioCurrentTime}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (audioRef.current) {
                  audioRef.current.currentTime = val;
                  setAudioCurrentTime(val);
                }
              }}
              aria-label="Seek audio timeline"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>

          <div className="flex items-center justify-between text-[12px] font-sans font-medium tabular-nums text-[#8c8c8c]">
            <span>{formatDuration(audioCurrentTime)}</span>
            <span>{formatDuration(audioDuration)}</span>
          </div>
        </div>

        {/* Controls row */}
        <div className="flex items-center justify-between w-full pt-2 border-t border-[#1a1a1a]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!audioRef.current) return;
                audioRef.current.muted = !isAudioMuted;
                setIsAudioMuted(!isAudioMuted);
              }}
              className="text-[#8c8c8c] hover:text-white p-1 rounded-[4px] hover:bg-[#1a1a1a] transition-colors cursor-pointer"
            >
              {isAudioMuted ? (
                <VolumeX className="w-4 h-4 text-rose-400" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={isAudioMuted ? 0 : audioVolume}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setAudioVolume(val);
                if (audioRef.current) {
                  audioRef.current.volume = val;
                  setIsAudioMuted(val === 0);
                }
              }}
              aria-label="Adjust audio volume"
              className="w-16 h-1 bg-[#262626] rounded-full appearance-none accent-white cursor-pointer"
            />
          </div>

          <button
            type="button"
            onClick={toggleAudioPlay}
            className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:bg-[#e0e0e0] transition-colors cursor-pointer shadow-xs"
          >
            {isAudioPlaying ? (
              <Pause className="w-4 h-4 fill-black" />
            ) : (
              <Play className="w-4 h-4 fill-black translate-x-0.5" />
            )}
          </button>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsAudioLoop((prev) => !prev)}
              title={isAudioLoop ? "Loop Enabled" : "Loop Disabled"}
              className={`p-1.5 rounded-[4px] transition-colors cursor-pointer ${
                isAudioLoop
                  ? "text-white bg-[#222222]"
                  : "text-[#8c8c8c] hover:text-white hover:bg-[#1a1a1a]"
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            {onDownload && (
              <button
                type="button"
                onClick={onDownload}
                title="Download Audio"
                className="text-[#8c8c8c] hover:text-white p-1.5 rounded-[4px] hover:bg-[#1a1a1a] transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER: IMAGE
  // ─────────────────────────────────────────────────────────────
  if (isImage) {
    return (
      <div
        className={`relative flex flex-col items-center justify-center bg-[#09090b] rounded-[8px] overflow-hidden border border-[#222222] min-h-[350px] font-sans ${className}`}
      >
        {/* Floating Zoom Toolbar */}
        <div className="absolute top-3 right-3 z-20 flex items-center gap-1 bg-[#141414]/90 backdrop-blur-xs border border-[#262626] p-1 rounded-[6px] text-white shadow-xl">
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.max(0.25, z - 0.25))}
            title="Zoom Out"
            className="w-7 h-7 flex items-center justify-center rounded-[4px] hover:bg-[#222222] text-[#cccccc] hover:text-white transition-colors cursor-pointer"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-[13px] font-sans font-medium tabular-nums px-1.5 text-[#a3a3a3] select-none min-w-[42px] text-center">
            {Math.round(zoomLevel * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.min(4, z + 0.25))}
            title="Zoom In"
            className="w-7 h-7 flex items-center justify-center rounded-[4px] hover:bg-[#222222] text-[#cccccc] hover:text-white transition-colors cursor-pointer"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-4 bg-[#262626] mx-0.5" />
          <button
            type="button"
            onClick={() => {
              setZoomLevel(1);
              setPanPosition({ x: 0, y: 0 });
            }}
            title="Fit to Screen (Reset pan and zoom)"
            className="px-2 h-7 flex items-center justify-center rounded-[4px] hover:bg-[#222222] text-[12px] font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer"
          >
            Fit
          </button>
        </div>

        {/* Image viewport with checkerboard pattern for alpha transparency, wheel zoom & drag to move */}
        <div
          ref={imgViewportRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={() => {
            if (zoomLevel !== 1 || panPosition.x !== 0 || panPosition.y !== 0) {
              setZoomLevel(1);
              setPanPosition({ x: 0, y: 0 });
            } else {
              setZoomLevel(2);
            }
          }}
          className={`w-full flex-1 flex items-center justify-center p-6 overflow-hidden max-h-[72vh] select-none touch-none ${
            isDraggingImage ? "cursor-grabbing" : "cursor-grab"
          }`}
          style={{
            backgroundImage:
              "linear-gradient(45deg, #111 25%, transparent 25%), linear-gradient(-45deg, #111 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #111 75%), linear-gradient(-45deg, transparent 75%, #111 75%)",
            backgroundSize: "16px 16px",
            backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
          }}
        >
          <img
            src={url}
            alt={name}
            style={{
              transform: `translate3d(${panPosition.x}px, ${panPosition.y}px, 0px) scale(${zoomLevel})`,
              transformOrigin: "center center",
              transition: isDraggingImage ? "none" : "transform 100ms ease-out",
            }}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              setImgNaturalSize({
                width: img.naturalWidth,
                height: img.naturalHeight,
              });
            }}
            className="max-h-[65vh] w-auto max-w-full object-contain select-none shadow-2xl rounded-[4px] pointer-events-none"
          />
        </div>

        {/* Footer Info */}
        {imgNaturalSize && (
          <div className="w-full px-4 py-2 bg-[#0c0c0c] border-t border-[#1f1f1f] flex items-center justify-between text-[13px] font-sans font-medium text-[#8c8c8c]">
            <span>
              {imgNaturalSize.width} &times; {imgNaturalSize.height} px
            </span>
            <span>{formatBytes(size || 0)}</span>
          </div>
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER: PDF
  // ─────────────────────────────────────────────────────────────
  if (isPdf) {
    return (
      <div
        className={`w-full flex flex-col bg-[#09090b] border border-[#222222] rounded-[8px] overflow-hidden font-sans ${className}`}
      >
        {!hideHeader && (
          <div className="h-10 px-4 bg-[#0c0c0c] border-b border-[#1f1f1f] flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13px] text-white font-medium truncate">
              <FileText className="w-4 h-4 text-[#8c8c8c]" />
              <span className="truncate">{name}</span>
            </div>
            {onDownload && (
              <button
                type="button"
                onClick={onDownload}
                className="inline-flex items-center gap-1.5 text-[12px] text-[#cccccc] hover:text-white px-2.5 py-1 rounded-[6px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" /> Download PDF
              </button>
            )}
          </div>
        )}
        <iframe
          src={url}
          title={name}
          className="w-full h-[72vh] bg-[#141414] border-none"
        />
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER: CODE OR TEXT
  // ─────────────────────────────────────────────────────────────
  if (isCodeOrText) {
    return (
      <div
        className={`relative w-full flex flex-col bg-[#09090b] border border-[#222222] rounded-[8px] overflow-hidden font-sans ${className}`}
      >
        {/* Header bar - only show when not hidden by modal */}
        {!hideHeader ? (
          <div className="h-10 px-4 bg-[#0c0c0c] border-b border-[#1f1f1f] flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13px] text-white font-medium truncate">
              <FileCode className="w-4 h-4 text-[#8c8c8c]" />
              <span className="truncate">{name}</span>
              <span className="text-[12px] font-sans font-medium text-[#8c8c8c] bg-[#141414] px-2 py-0.5 rounded-[4px] border border-[#262626]">
                {formatBytes(size || textContent?.length || 0)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyText}
                disabled={!textContent}
                className="inline-flex items-center gap-1.5 text-[12px] text-[#cccccc] hover:text-white px-2.5 py-1 rounded-[6px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] transition-colors cursor-pointer disabled:opacity-50"
              >
                {copiedCode ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedCode ? "Copied" : "Copy Text"}</span>
              </button>

              {onDownload && (
                <button
                  type="button"
                  onClick={onDownload}
                  className="inline-flex items-center gap-1.5 text-[12px] text-[#cccccc] hover:text-white px-2.5 py-1 rounded-[6px] bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          /* Floating copy button for modal view */
          <div className="absolute top-2.5 right-2.5 z-10">
            <button
              type="button"
              onClick={handleCopyText}
              disabled={!textContent}
              className="inline-flex items-center gap-1.5 text-[12px] text-[#cccccc] hover:text-white px-2.5 py-1 rounded-[5px] bg-[#141414]/90 hover:bg-[#1c1c1c] border border-[#282828] backdrop-blur-xs transition-colors cursor-pointer shadow-md disabled:opacity-50"
            >
              {copiedCode ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copiedCode ? "Copied" : "Copy Text"}</span>
            </button>
          </div>
        )}

        {/* Content Area */}
        <div className="p-4 overflow-auto max-h-[68vh] font-mono text-[13px] leading-relaxed text-[#d4d4d4] bg-[#09090b]">
          {isLoadingText ? (
            <div className="py-12 text-center text-[#8c8c8c]">
              Loading file content...
            </div>
          ) : textError ? (
            <div className="py-8 text-center text-[#e5484d] space-y-2">
              <p>{textError}</p>
              {onDownload && (
                <button
                  type="button"
                  onClick={onDownload}
                  className="px-3 py-1.5 rounded-[6px] bg-white text-black font-medium text-[12px] cursor-pointer"
                >
                  Download File
                </button>
              )}
            </div>
          ) : textContent !== null ? (
            <pre className="whitespace-pre-wrap break-all select-text">
              {textContent}
            </pre>
          ) : null}
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER: GENERIC BINARY / OTHER
  // ─────────────────────────────────────────────────────────────
  return (
    <div
      className={`p-8 bg-[#0c0c0c] border border-[#222222] rounded-[8px] flex flex-col items-center justify-center max-w-md mx-auto text-center font-sans ${className}`}
    >
      <div className="w-12 h-12 rounded-[8px] bg-[#141414] border border-[#262626] flex items-center justify-center mb-3 text-[#cccccc]">
        {getFileIcon(name, "w-6 h-6")}
      </div>
      <h3 className="text-white text-[16px] font-sans font-semibold truncate max-w-full leading-snug">
        {name}
      </h3>
      <p className="text-[13.5px] text-[#8c8c8c] mt-1 mb-5 font-sans font-normal">
        {contentType || "application/octet-stream"} &bull;{" "}
        {formatBytes(size || 0)}
      </p>

      {onDownload && (
        <button
          type="button"
          onClick={onDownload}
          className="inline-flex items-center justify-center gap-2 h-8 px-4 rounded-[6px] bg-white text-black font-sans font-medium text-[13px] hover:bg-[#e0e0e0] transition-colors cursor-pointer w-full shadow-xs"
        >
          <Download className="w-4 h-4 stroke-[2.5]" /> Download File
        </button>
      )}
    </div>
  );
}
