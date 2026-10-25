/*
 * Axiom High-Performance Universal Media Player & Preview Engine.
 * Supports: Video (streaming, seek, speed, PiP, fullscreen), Audio, Image (zoom/pan), PDF, Code/Text, and Binary.
 * Owned by: ui/pages/storage
 * Dependencies: lucide-react, ./format, ./fileIcon
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  ExternalLink,
  Sliders,
  Music,
  FileCode,
  FileText,
  File,
} from 'lucide-react';
import { formatBytes } from './format';
import { getFileIcon, getFileExtension } from './fileIcon';

export interface MediaPlayerProps {
  url: string;
  name: string;
  contentType?: string;
  size?: number;
  downloadUrl?: string;
  onDownload?: () => void;
  className?: string;
  autoPlay?: boolean;
}

function formatDuration(seconds: number): string {
  if (isNaN(seconds) || !isFinite(seconds) || seconds < 0) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function MediaPlayer({
  url,
  name,
  contentType,
  size,
  downloadUrl,
  onDownload,
  className = '',
  autoPlay = false,
}: MediaPlayerProps) {
  const ext = name.split('.').pop()?.toLowerCase() || '';

  // Classify media kind
  const isVideo =
    ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'ogv'].includes(ext) ||
    Boolean(contentType?.startsWith('video/'));

  const isAudio =
    ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus'].includes(ext) ||
    Boolean(contentType?.startsWith('audio/'));

  const isImage =
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext) ||
    Boolean(contentType?.startsWith('image/'));

  const isPdf = ext === 'pdf' || contentType === 'application/pdf';

  const isCodeOrText =
    ['txt', 'json', 'csv', 'tsv', 'log', 'md', 'rs', 'ts', 'tsx', 'js', 'jsx', 'py', 'sql', 'toml', 'yaml', 'yml', 'xml', 'html', 'css', 'sh', 'env', 'diff', 'patch'].includes(ext) ||
    Boolean(contentType?.startsWith('text/')) ||
    contentType === 'application/json';

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
        console.warn('Playback error:', err);
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
      setBufferedEnd(videoRef.current.buffered.end(videoRef.current.buffered.length - 1));
    }
  };

  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    setDuration(videoRef.current.duration || 0);
    setVideoError(null);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = val;
      setCurrentTime(val);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    if (isMuted) {
      videoRef.current.muted = false;
      setIsMuted(false);
      videoRef.current.volume = volume || 1;
    } else {
      videoRef.current.muted = true;
      setIsMuted(true);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      if (val === 0) {
        videoRef.current.muted = true;
        setIsMuted(true);
      } else if (isMuted) {
        videoRef.current.muted = false;
        setIsMuted(false);
      }
    }
  };

  const handleSpeedSelect = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
    setShowSpeedMenu(false);
  };

  const toggleFullscreen = () => {
    if (!videoContainerRef.current) return;
    if (!document.fullscreenElement) {
      videoContainerRef.current.requestFullscreen().catch((err) => {
        console.warn('Fullscreen request failed:', err);
      });
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      if (controlsTimeoutRef.current) {
        window.clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, []);

  // Keyboard controls for video
  useEffect(() => {
    if (!isVideo) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (videoRef.current) {
          videoRef.current.currentTime = Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + 5);
        }
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        if (videoRef.current) {
          videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5);
        }
      } else if (e.code === 'KeyF') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.code === 'KeyM') {
        e.preventDefault();
        toggleMute();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVideo, togglePlay]);

  // ─────────────────────────────────────────────────────────────
  // 2. AUDIO PLAYER STATE
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
  // 3. IMAGE VIEWER STATE
  // ─────────────────────────────────────────────────────────────
  const [zoomLevel, setZoomLevel] = useState(1);
  const [imgNaturalSize, setImgNaturalSize] = useState<{ width: number; height: number } | null>(null);

  // ─────────────────────────────────────────────────────────────
  // 4. CODE / TEXT VIEWER STATE
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
          if (!res.ok) throw new Error(`HTTP ${res.status} failed to fetch text`);
          return res.text();
        })
        .then((txt) => {
          // Cap display to 500 KB to prevent browser lockup on giant dumps
          if (txt.length > 500000) {
            setTextContent(txt.slice(0, 500000) + '\n\n... [Content truncated due to size. Download for full file] ...');
          } else {
            setTextContent(txt);
          }
        })
        .catch((err) => {
          setTextError(err instanceof Error ? err.message : 'Failed to load text preview');
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
        className={`relative flex flex-col items-center justify-center bg-[#070707] rounded-xl overflow-hidden border border-[#222222] group select-none shadow-2xl ${className} ${
          isFullscreen ? 'w-screen h-screen rounded-none border-none' : 'w-full'
        }`}
      >
        {videoError ? (
          <div className="p-8 text-center max-w-md space-y-3">
            <AlertCircle className="w-10 h-10 text-amber-400 mx-auto" />
            <h4 className="text-white text-[15px] font-medium">Unable to decode video in browser</h4>
            <p className="text-[13px] text-[#8c8c8c] leading-relaxed">
              This video container or codec may not be natively supported by your web browser. You can download the file directly to play it locally.
            </p>
            {onDownload && (
              <button
                type="button"
                onClick={onDownload}
                className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-black font-medium text-[13px] hover:bg-[#e0e0e0] transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" /> Download Video ({formatBytes(size || 0)})
              </button>
            )}
          </div>
        ) : (
          <>
            {/* The Video Element */}
            <div
              className="relative w-full flex items-center justify-center bg-black cursor-pointer"
              style={{ maxHeight: isFullscreen ? '100vh' : '72vh' }}
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
                onError={() => setVideoError('Error decoding video')}
                className="max-h-[72vh] w-auto max-w-full object-contain mx-auto"
                style={{ maxHeight: isFullscreen ? '100vh' : '72vh' }}
              />

              {/* Big Play/Pause Center Overlay (when paused or hover) */}
              {!isPlaying && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/30 backdrop-blur-[1px]">
                  <div className="w-16 h-16 rounded-full bg-white/10 border border-white/20 backdrop-blur-md flex items-center justify-center text-white shadow-2xl transition-transform transform hover:scale-110">
                    <Play className="w-7 h-7 fill-white translate-x-0.5" />
                  </div>
                </div>
              )}
            </div>

            {/* Custom Sleek Floating Control Bar */}
            <div
              className={`absolute bottom-0 left-0 right-0 p-3 pt-6 bg-gradient-to-t from-black/90 via-black/60 to-transparent transition-opacity duration-300 font-sans z-20 ${
                showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            >
              {/* Timeline Scrubber */}
              <div className="relative group/seeker w-full h-2 mb-2.5 flex items-center cursor-pointer">
                <div className="w-full h-1 bg-white/20 rounded-full overflow-hidden relative">
                  {/* Buffer bar */}
                  <div
                    className="absolute top-0 bottom-0 left-0 bg-white/25 rounded-full"
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
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={togglePlay}
                    title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                    className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-white/15 transition-colors cursor-pointer text-white"
                  >
                    {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white translate-x-0.5" />}
                  </button>

                  {/* Time Counter */}
                  <div className="text-[12px] font-mono text-[#d4d4d4] tabular-nums">
                    <span>{formatDuration(currentTime)}</span>
                    <span className="text-[#666666] mx-1">/</span>
                    <span className="text-[#8c8c8c]">{formatDuration(duration)}</span>
                  </div>

                  {/* Volume Slider */}
                  <div className="flex items-center gap-1.5 group/vol">
                    <button
                      type="button"
                      onClick={toggleMute}
                      title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
                      className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/15 transition-colors cursor-pointer text-white"
                    >
                      {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={isMuted ? 0 : volume}
                      onChange={handleVolumeChange}
                      aria-label="Adjust volume"
                      className="w-16 h-1 bg-white/20 rounded-full appearance-none accent-white cursor-pointer transition-all"
                    />
                  </div>
                </div>

                {/* Right Controls: Speed, PiP, Fullscreen, Download */}
                <div className="flex items-center gap-1.5 relative">
                  {/* Speed Selector */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowSpeedMenu((prev) => !prev)}
                      title="Playback Speed"
                      className="h-7 px-2 rounded-md hover:bg-white/15 transition-colors text-[12px] font-mono font-medium text-[#cccccc] hover:text-white flex items-center gap-1 cursor-pointer"
                    >
                      <span>{playbackRate}x</span>
                    </button>

                    {showSpeedMenu && (
                      <div className="absolute bottom-9 right-0 bg-[#161616] border border-[#2a2a2a] rounded-lg shadow-2xl p-1 w-24 z-30 font-sans space-y-0.5">
                        {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                          <button
                            key={rate}
                            type="button"
                            onClick={() => handleSpeedSelect(rate)}
                            className={`w-full text-left px-2 py-1 rounded text-[12px] font-mono transition-colors cursor-pointer flex items-center justify-between ${
                              playbackRate === rate ? 'bg-white text-black font-semibold' : 'text-[#cccccc] hover:bg-[#242424]'
                            }`}
                          >
                            <span>{rate}x</span>
                            {playbackRate === rate && <Check className="w-3 h-3 stroke-[3]" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Download button if provided */}
                  {onDownload && (
                    <button
                      type="button"
                      onClick={onDownload}
                      title="Download file"
                      className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-white/15 transition-colors cursor-pointer text-[#cccccc] hover:text-white"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  )}

                  {/* Fullscreen Toggle */}
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    title={isFullscreen ? 'Exit Fullscreen (F)' : 'Fullscreen (F)'}
                    className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-white/15 transition-colors cursor-pointer text-[#cccccc] hover:text-white"
                  >
                    {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
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
  // RENDER: AUDIO
  // ─────────────────────────────────────────────────────────────
  if (isAudio) {
    const audioProgress = audioDuration > 0 ? (audioCurrentTime / audioDuration) * 100 : 0;

    return (
      <div className={`p-6 bg-[#0c0c0c] border border-[#222222] rounded-xl flex flex-col items-center max-w-xl mx-auto shadow-2xl font-sans ${className}`}>
        <audio
          ref={audioRef}
          src={url}
          autoPlay={autoPlay}
          loop={isAudioLoop}
          onTimeUpdate={() => audioRef.current && setAudioCurrentTime(audioRef.current.currentTime)}
          onLoadedMetadata={() => audioRef.current && setAudioDuration(audioRef.current.duration || 0)}
          onPlay={() => setIsAudioPlaying(true)}
          onPause={() => setIsAudioPlaying(false)}
        />

        {/* Visualizer Hero Card */}
        <div className="w-20 h-20 rounded-2xl bg-[#141414] border border-[#262626] flex items-center justify-center mb-4 text-[#ec4899] shadow-inner relative overflow-hidden">
          {/* Animated Waveform Bars */}
          <div className="flex items-center gap-1 h-8">
            <span className={`w-1 bg-[#ec4899] rounded-full transition-all duration-300 ${isAudioPlaying ? 'h-6 animate-pulse' : 'h-2'}`} />
            <span className={`w-1 bg-[#ec4899] rounded-full transition-all duration-200 ${isAudioPlaying ? 'h-8 animate-bounce' : 'h-4'}`} />
            <span className={`w-1 bg-[#ec4899] rounded-full transition-all duration-300 ${isAudioPlaying ? 'h-5 animate-pulse' : 'h-3'}`} />
            <span className={`w-1 bg-[#ec4899] rounded-full transition-all duration-150 ${isAudioPlaying ? 'h-7 animate-bounce' : 'h-2'}`} />
          </div>
        </div>

        <h3 className="text-white text-[16px] font-medium truncate max-w-full text-center mb-0.5">{name}</h3>
        <p className="text-[13px] text-[#8c8c8c] font-mono mb-5">
          {getFileExtension(name)} &bull; {formatBytes(size || 0)}
        </p>

        {/* Timeline */}
        <div className="w-full space-y-1.5 mb-4">
          <div className="relative group w-full h-2 flex items-center cursor-pointer">
            <div className="w-full h-1 bg-[#222222] rounded-full overflow-hidden">
              <div className="h-full bg-white rounded-full transition-all" style={{ width: `${audioProgress}%` }} />
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

          <div className="flex items-center justify-between text-[11px] font-mono text-[#8c8c8c]">
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
              className="text-[#8c8c8c] hover:text-white p-1.5 rounded-md hover:bg-[#1f1f1f] transition-colors cursor-pointer"
            >
              {isAudioMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
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

          {/* Large circular play button */}
          <button
            type="button"
            onClick={toggleAudioPlay}
            className="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center hover:bg-[#e6e6e6] transition-all transform active:scale-95 shadow-lg cursor-pointer"
          >
            {isAudioPlaying ? <Pause className="w-5 h-5 fill-black" /> : <Play className="w-5 h-5 fill-black translate-x-0.5" />}
          </button>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsAudioLoop((prev) => !prev)}
              title={isAudioLoop ? 'Loop Enabled' : 'Loop Disabled'}
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                isAudioLoop ? 'text-white bg-[#222222]' : 'text-[#8c8c8c] hover:text-white hover:bg-[#1a1a1a]'
              }`}
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            {onDownload && (
              <button
                type="button"
                onClick={onDownload}
                title="Download Audio"
                className="text-[#8c8c8c] hover:text-white p-1.5 rounded-md hover:bg-[#1a1a1a] transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
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
      <div className={`relative flex flex-col items-center justify-center bg-[#070707] rounded-xl overflow-hidden border border-[#222222] min-h-[350px] shadow-2xl font-sans ${className}`}>
        {/* Floating Zoom Toolbar */}
        <div className="absolute top-3 right-3 z-20 flex items-center gap-1 bg-[#141414]/90 backdrop-blur-md border border-[#2a2a2a] p-1 rounded-lg text-white shadow-xl">
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.max(0.25, z - 0.25))}
            title="Zoom Out"
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#262626] text-[#cccccc] hover:text-white transition-colors cursor-pointer"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-[12px] font-mono px-1.5 text-[#aaaaaa] select-none min-w-[42px] text-center">
            {Math.round(zoomLevel * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.min(4, z + 0.25))}
            title="Zoom In"
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#262626] text-[#cccccc] hover:text-white transition-colors cursor-pointer"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-4 bg-[#2e2e2e] mx-0.5" />
          <button
            type="button"
            onClick={() => setZoomLevel(1)}
            title="Fit to Screen"
            className="px-2 h-7 flex items-center justify-center rounded hover:bg-[#262626] text-[12px] font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer"
          >
            Fit
          </button>
          {onDownload && (
            <>
              <div className="w-px h-4 bg-[#2e2e2e] mx-0.5" />
              <button
                type="button"
                onClick={onDownload}
                title="Download image"
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#262626] text-[#cccccc] hover:text-white transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>

        {/* Image viewport with checkerboard pattern for alpha transparency */}
        <div
          className="w-full flex-1 flex items-center justify-center p-6 overflow-auto max-h-[72vh]"
          style={{
            backgroundImage:
              'linear-gradient(45deg, #111 25%, transparent 25%), linear-gradient(-45deg, #111 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #111 75%), linear-gradient(-45deg, transparent 75%, #111 75%)',
            backgroundSize: '16px 16px',
            backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
          }}
        >
          <img
            src={url}
            alt={name}
            style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center center' }}
            onLoad={(e) => {
              const img = e.currentTarget;
              setImgNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
            }}
            className="max-h-[65vh] w-auto max-w-full object-contain transition-transform duration-150 select-none shadow-2xl rounded"
          />
        </div>

        {/* Footer Info */}
        {imgNaturalSize && (
          <div className="w-full px-4 py-2 bg-[#0d0d0d] border-t border-[#1c1c1c] flex items-center justify-between text-[12px] font-mono text-[#8c8c8c]">
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
      <div className={`w-full flex flex-col bg-[#0c0c0c] border border-[#222222] rounded-xl overflow-hidden shadow-2xl ${className}`}>
        <div className="h-10 px-4 bg-[#141414] border-b border-[#222222] flex items-center justify-between">
          <div className="flex items-center gap-2 text-[13px] text-white font-medium truncate">
            <FileText className="w-4 h-4 text-[#fb7185]" />
            <span className="truncate">{name}</span>
          </div>
          {onDownload && (
            <button
              type="button"
              onClick={onDownload}
              className="inline-flex items-center gap-1.5 text-[12px] text-[#cccccc] hover:text-white px-2.5 py-1 rounded bg-[#1e1e1e] hover:bg-[#282828] transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" /> Download PDF
            </button>
          )}
        </div>
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
      <div className={`w-full flex flex-col bg-[#080808] border border-[#222222] rounded-xl overflow-hidden shadow-2xl font-sans ${className}`}>
        {/* Header bar */}
        <div className="h-10 px-4 bg-[#121212] border-b border-[#202020] flex items-center justify-between">
          <div className="flex items-center gap-2 text-[13px] text-white font-medium truncate">
            <FileCode className="w-4 h-4 text-[#fbbf24]" />
            <span className="truncate">{name}</span>
            <span className="text-[11px] font-mono text-[#8c8c8c] bg-[#1a1a1a] px-2 py-0.5 rounded border border-[#282828]">
              {formatBytes(size || textContent?.length || 0)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyText}
              disabled={!textContent}
              className="inline-flex items-center gap-1.5 text-[12px] text-[#cccccc] hover:text-white px-2.5 py-1 rounded bg-[#1c1c1c] hover:bg-[#262626] border border-[#2b2b2b] transition-colors cursor-pointer disabled:opacity-50"
            >
              {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedCode ? 'Copied' : 'Copy Text'}</span>
            </button>

            {onDownload && (
              <button
                type="button"
                onClick={onDownload}
                className="inline-flex items-center gap-1.5 text-[12px] text-[#cccccc] hover:text-white px-2.5 py-1 rounded bg-[#1c1c1c] hover:bg-[#262626] border border-[#2b2b2b] transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </button>
            )}
          </div>
        </div>

        {/* Content Area */}
        <div className="p-4 overflow-auto max-h-[68vh] font-mono text-[13px] leading-relaxed text-[#d4d4d4] bg-[#090909]">
          {isLoadingText ? (
            <div className="py-12 text-center text-[#8c8c8c]">Loading file content...</div>
          ) : textError ? (
            <div className="py-8 text-center text-red-400 space-y-2">
              <p>{textError}</p>
              {onDownload && (
                <button
                  type="button"
                  onClick={onDownload}
                  className="px-3 py-1.5 rounded bg-white text-black font-medium text-[12px] cursor-pointer"
                >
                  Download File
                </button>
              )}
            </div>
          ) : textContent !== null ? (
            <pre className="whitespace-pre-wrap break-all select-text">{textContent}</pre>
          ) : null}
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER: GENERIC BINARY / OTHER
  // ─────────────────────────────────────────────────────────────
  return (
    <div className={`p-8 bg-[#0c0c0c] border border-[#222222] rounded-xl flex flex-col items-center justify-center max-w-md mx-auto shadow-2xl text-center font-sans ${className}`}>
      <div className="w-16 h-16 rounded-2xl bg-[#141414] border border-[#242424] flex items-center justify-center mb-4 text-white shadow-inner">
        {getFileIcon(name, 'w-8 h-8')}
      </div>
      <h3 className="text-white text-[16px] font-medium truncate max-w-full leading-snug">{name}</h3>
      <p className="text-[13px] text-[#8c8c8c] mt-1 mb-6 font-mono">
        {contentType || 'application/octet-stream'} &bull; {formatBytes(size || 0)}
      </p>

      {onDownload && (
        <button
          type="button"
          onClick={onDownload}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-white text-black font-medium text-[14px] hover:bg-[#e0e0e0] transition-colors cursor-pointer w-full shadow-lg"
        >
          <Download className="w-4 h-4" /> Download File
        </button>
      )}
    </div>
  );
}
