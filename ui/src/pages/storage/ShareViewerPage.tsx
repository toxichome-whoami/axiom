/*
 * Axiom Standalone Media & Capability Share Viewer Page.
 * Renders an industrial-grade media preview for capability links and Public CDN objects.
 * Public route (accessible without active admin session).
 * Owned by: ui/pages/storage
 * Dependencies: lucide-react, ./MediaPlayer, ./format, ./fileIcon
 */

import React, { useState, useEffect } from "react";
import {
  Download,
  Copy,
  Check,
  ShieldCheck,
  Clock,
  AlertTriangle,
  HardDrive,
  Globe,
  ExternalLink,
} from "lucide-react";
import { MediaPlayer } from "./MediaPlayer";
import { formatBytes } from "./format";
import { getFileIcon, getFileExtension } from "./fileIcon";

export function ShareViewerPage() {
  const [params, setParams] = useState<{
    namespace: string;
    key: string;
    ticket_sig?: string;
    ticket_exp?: number;
    isPublic?: boolean;
  } | null>(null);

  const [contentType, setContentType] = useState<string>("");
  const [fileSize, setFileSize] = useState<number>(0);
  const [isLoadingMeta, setIsLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  // Parse query parameters on mount
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const ns = searchParams.get("ns") || searchParams.get("namespace") || "";
    const key =
      searchParams.get("key") ||
      searchParams.get("path") ||
      searchParams.get("file") ||
      "";
    const sig = searchParams.get("ticket_sig") || searchParams.get("sig") || "";
    const expStr =
      searchParams.get("ticket_exp") || searchParams.get("exp") || "0";
    const exp = parseInt(expStr, 10) || 0;

    if (!ns || !key) {
      setMetaError("Incomplete parameters. Missing namespace or file key.");
      setIsLoadingMeta(false);
      return;
    }

    // If signature is present, it's a capability ticket
    if (sig) {
      setParams({
        namespace: ns,
        key,
        ticket_sig: sig,
        ticket_exp: exp,
        isPublic: false,
      });
      return;
    }

    // If no signature, check if the namespace/object is public
    const sanitizedKey = key.split("/").map(encodeURIComponent).join("/");
    const publicHeadUrl = `/api/v1/blobs/public/${encodeURIComponent(ns)}/${sanitizedKey}?inline=1`;

    fetch(publicHeadUrl, { method: "HEAD" })
      .then((res) => {
        if (!res.ok) {
          throw new Error(
            "This object is private and requires a valid capability ticket signature.",
          );
        }
        const ct = res.headers.get("content-type") || "";
        const cl = res.headers.get("content-length");
        setContentType(ct);
        if (cl) setFileSize(parseInt(cl, 10) || 0);

        setParams({
          namespace: ns,
          key,
          isPublic: true,
        });
      })
      .catch((err) => {
        setMetaError(err instanceof Error ? err.message : "Object unavailable");
      })
      .finally(() => {
        setIsLoadingMeta(false);
      });
  }, []);

  // Fetch HEAD metadata for signed capability tickets
  useEffect(() => {
    if (!params || params.isPublic) return;

    const nowSecs = Math.floor(Date.now() / 1000);
    if (
      params.ticket_exp &&
      params.ticket_exp > 0 &&
      nowSecs > params.ticket_exp
    ) {
      setMetaError(
        "This capability share link has expired. Please request a new link from the owner.",
      );
      setIsLoadingMeta(false);
      return;
    }

    const sanitizedKey = params.key
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const headUrl = `/api/v1/blobs/objects/${encodeURIComponent(params.namespace)}/${sanitizedKey}?ticket_sig=${encodeURIComponent(params.ticket_sig || "")}&ticket_exp=${encodeURIComponent(params.ticket_exp || 0)}&inline=1`;

    fetch(headUrl, { method: "HEAD", cache: "no-store" })
      .then((res) => {
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            throw new Error(
              "This capability link is invalid or has been revoked.",
            );
          }
          if (res.status === 404) {
            throw new Error(
              "The requested object does not exist or was deleted.",
            );
          }
          throw new Error(
            `Failed to load object metadata (HTTP ${res.status})`,
          );
        }
        const ct = res.headers.get("content-type") || "";
        const cl = res.headers.get("content-length");
        setContentType(ct);
        if (cl) {
          setFileSize(parseInt(cl, 10) || 0);
        }
      })
      .catch((err) => {
        setMetaError(
          err instanceof Error ? err.message : "Failed to inspect object",
        );
      })
      .finally(() => {
        setIsLoadingMeta(false);
      });
  }, [params]);

  if (!params && isLoadingMeta) {
    return (
      <div className="min-h-[100dvh] h-[100dvh] bg-[#09090b] text-white flex items-center justify-center font-sans">
        <div className="flex items-center gap-3 text-[#8c8c8c] text-[13px]">
          <svg
            className="animate-spin h-4 w-4 text-white"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            />
          </svg>
          <span>Loading media preview...</span>
        </div>
      </div>
    );
  }

  if (metaError || !params) {
    return (
      <div className="min-h-[100dvh] h-[100dvh] bg-[#09090b] text-white flex flex-col items-center justify-center p-4 sm:p-6 font-sans">
        <div className="max-w-md w-full bg-[#0c0c0c] border border-[#262626] rounded-[8px] p-6 text-center shadow-2xl space-y-3 font-sans">
          <div className="w-10 h-10 rounded-[6px] bg-red-950/30 border border-red-900/50 flex items-center justify-center mx-auto text-red-400">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <h2 className="text-[16px] font-sans font-medium text-white tracking-tight">
            Link Unavailable
          </h2>
          <p className="text-[13px] text-[#8c8c8c] leading-relaxed">
            {metaError || "Unable to load capability share link."}
          </p>
        </div>
      </div>
    );
  }

  const fileName = params.key.split("/").pop() || params.key;
  const sanitizedKey = params.key.split("/").map(encodeURIComponent).join("/");

  const streamUrl = params.isPublic
    ? `/api/v1/blobs/public/${encodeURIComponent(params.namespace)}/${sanitizedKey}?inline=1`
    : `/api/v1/blobs/objects/${encodeURIComponent(params.namespace)}/${sanitizedKey}?ticket_sig=${encodeURIComponent(params.ticket_sig || "")}&ticket_exp=${encodeURIComponent(params.ticket_exp || 0)}&inline=1`;

  const downloadUrl = params.isPublic
    ? `/api/v1/blobs/public/${encodeURIComponent(params.namespace)}/${sanitizedKey}`
    : `/api/v1/blobs/objects/${encodeURIComponent(params.namespace)}/${sanitizedKey}?ticket_sig=${encodeURIComponent(params.ticket_sig || "")}&ticket_exp=${encodeURIComponent(params.ticket_exp || 0)}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const now = Math.floor(Date.now() / 1000);
  const remainingSecs = Math.max(0, (params.ticket_exp || 0) - now);
  const remainingHours = Math.floor(remainingSecs / 3600);
  const remainingMins = Math.floor((remainingSecs % 3600) / 60);

  return (
    <div className="min-h-[100dvh] h-[100dvh] max-h-[100dvh] bg-[#09090b] text-white flex flex-col font-sans selection:bg-neutral-700 selection:text-white overflow-hidden">
      {/* ─── Header: Navigation Bar (Google Drive dark previewer style) ─── */}
      <header className="h-14 sm:h-16 border-b border-[#1f1f1f] bg-[#0c0c0c]/95 backdrop-blur-md sticky top-0 z-40 px-3 sm:px-6 flex items-center justify-between shrink-0 gap-2">
        {/* Left: File icon + Title + Extension/Public Pill */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            <div className="shrink-0 text-[#cccccc]">
              {getFileIcon(fileName, "w-4 h-4")}
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
              <span
                className="text-[14px] sm:text-[15px] font-sans font-semibold text-white tracking-tight truncate max-w-[120px] xs:max-w-[180px] sm:max-w-xs md:max-w-md lg:max-w-lg"
                title={fileName}
              >
                {fileName}
              </span>
              <span className="text-[11px] sm:text-[12px] font-sans font-medium px-1.5 sm:px-2 py-0.5 rounded-[5px] bg-[#161616] border border-[#282828] text-[#999999] shrink-0 hidden xs:inline">
                {getFileExtension(fileName)}
              </span>
              {params.isPublic ? (
                <span className="px-1.5 sm:px-2 py-0.5 rounded-[5px] text-[11px] sm:text-[12px] font-sans font-medium bg-[#161616] border border-[#2e2e2e] text-[#cccccc] leading-none shrink-0 hidden sm:inline">
                  Public CDN
                </span>
              ) : (
                <span className="px-1.5 sm:px-2 py-0.5 rounded-[5px] text-[11px] sm:text-[12px] font-sans font-medium bg-[#161616] border border-[#2e2e2e] text-[#cccccc] leading-none shrink-0 hidden sm:inline">
                  Shared
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right Actions: Expiration (if ticket), Open Raw, Copy Link, White Download */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {!params.isPublic && params.ticket_exp && params.ticket_exp > 0 && (
            <div
              className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-[6px] bg-[#141414] border border-[#242424] text-[11px] sm:text-[12.5px] font-sans font-medium text-[#cccccc]"
              title={`Expires in ${remainingHours}h ${remainingMins}m`}
            >
              <Clock className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-amber-400 shrink-0" />
              <span className="hidden sm:inline">Expires in </span>
              <span className="tabular-nums">
                {remainingHours}h {remainingMins}m
              </span>
            </div>
          )}

          <a
            href={streamUrl}
            target="_blank"
            rel="noreferrer"
            title="Open raw stream directly"
            className="inline-flex items-center justify-center gap-1.5 h-8 px-2 sm:px-3 rounded-[6px] text-[12.5px] sm:text-[13px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#262626] transition-colors cursor-pointer shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Open Raw</span>
          </a>

          <button
            type="button"
            onClick={handleCopyLink}
            title="Copy share link"
            className="inline-flex items-center justify-center gap-1.5 h-8 px-2 sm:px-3 rounded-[6px] text-[12.5px] sm:text-[13px] font-sans font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#262626] transition-colors cursor-pointer shrink-0"
          >
            {isCopied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            <span className="hidden md:inline">
              {isCopied ? "Copied" : "Copy Link"}
            </span>
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center justify-center gap-1.5 h-8 px-2.5 sm:px-3.5 rounded-[6px] text-[12.5px] sm:text-[13px] font-sans font-semibold text-black bg-white hover:bg-neutral-200 shadow-xs transition-colors cursor-pointer shrink-0"
          >
            <Download className="w-3.5 h-3.5 stroke-[2.5]" />
            <span className="hidden xs:inline">Download</span>
          </button>
        </div>
      </header>

      {/* ─── Main Viewport Canvas (Centered immersive preview) ─── */}
      <main className="flex-1 min-h-0 w-full flex items-center justify-center p-2 sm:p-4 md:p-6 lg:p-8 bg-[#09090b] overflow-auto">
        <div className="w-full max-w-5xl h-full flex flex-col items-center justify-center min-h-0">
          <MediaPlayer
            url={streamUrl}
            name={fileName}
            contentType={contentType}
            size={fileSize}
            downloadUrl={downloadUrl}
            onDownload={handleDownload}
            autoPlay={false}
          />
        </div>
      </main>

      {/* ─── Footer: Minimal Google Drive / Axiom Telemetry ─── */}
      <footer className="min-h-10 sm:h-12 border-t border-[#1a1a1a] bg-[#0c0c0c] px-3 sm:px-4 md:px-6 text-[12px] sm:text-[13px] text-[#8c8c8c] font-sans flex flex-wrap items-center justify-between gap-y-1 py-1.5 sm:py-0 shrink-0 select-none">
        <div className="flex items-center gap-2 truncate">
          {params.isPublic ? (
            <>
              <Globe className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="truncate">
                Public CDN &bull; Zero Ticket Overhead
              </span>
            </>
          ) : (
            <>
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="truncate">
                <span className="hidden sm:inline">
                  Cryptographically signed{" "}
                </span>
                capability ticket
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-3 text-[12px] sm:text-[13px] shrink-0">
          <span className="hidden xs:inline">
            Namespace:{" "}
            <span className="font-sans font-medium text-white">
              {params.namespace}
            </span>
          </span>
          <span className="hidden xs:inline">&bull;</span>
          <span className="font-sans font-medium text-white tabular-nums">
            {formatBytes(fileSize)}
          </span>
          {contentType && (
            <>
              <span className="hidden md:inline">&bull;</span>
              <span className="font-sans text-[#8c8c8c] hidden md:inline truncate max-w-[120px]">
                {contentType}
              </span>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
