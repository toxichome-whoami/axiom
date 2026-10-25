/*
 * Axiom Standalone Capability Share Viewer Page.
 * Renders a high-fidelity, branded media preview for capability links.
 * Public route (accessible without active admin session when valid ticket_sig is present).
 * Owned by: ui/pages/storage
 * Dependencies: lucide-react, ./MediaPlayer, ./format, ./fileIcon
 */

import React, { useState, useEffect } from 'react';
import {
  Download,
  Copy,
  Check,
  ShieldCheck,
  Clock,
  AlertTriangle,
  HardDrive,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';
import { MediaPlayer } from './MediaPlayer';
import { formatBytes } from './format';
import { getFileIcon, getFileExtension } from './fileIcon';

export function ShareViewerPage() {
  const [params, setParams] = useState<{
    namespace: string;
    key: string;
    ticket_sig: string;
    ticket_exp: number;
  } | null>(null);

  const [contentType, setContentType] = useState<string>('');
  const [fileSize, setFileSize] = useState<number>(0);
  const [isLoadingMeta, setIsLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  // Parse query parameters on mount
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const ns = searchParams.get('ns') || searchParams.get('namespace') || '';
    const key = searchParams.get('key') || searchParams.get('path') || searchParams.get('file') || '';
    const sig = searchParams.get('ticket_sig') || searchParams.get('sig') || '';
    const expStr = searchParams.get('ticket_exp') || searchParams.get('exp') || '0';
    const exp = parseInt(expStr, 10) || 0;

    if (!ns || !key || !sig) {
      setMetaError('Incomplete capability ticket parameters. Missing namespace, key, or signature.');
      setIsLoadingMeta(false);
      return;
    }

    setParams({
      namespace: ns,
      key,
      ticket_sig: sig,
      ticket_exp: exp,
    });
  }, []);

  // Fetch HEAD metadata from blob API once params are parsed
  useEffect(() => {
    if (!params) return;

    // Check client-side expiration
    const nowSecs = Math.floor(Date.now() / 1000);
    if (params.ticket_exp > 0 && nowSecs > params.ticket_exp) {
      setMetaError('This capability share link has expired. Please request a new link from the owner.');
      setIsLoadingMeta(false);
      return;
    }

    const headUrl = `/api/v1/blobs/${encodeURIComponent(params.namespace)}/${encodeURIComponent(params.key)}?ticket_sig=${encodeURIComponent(params.ticket_sig)}&ticket_exp=${encodeURIComponent(params.ticket_exp)}&inline=1`;

    fetch(headUrl, { method: 'HEAD' })
      .then((res) => {
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            throw new Error('This capability link is invalid or has been revoked.');
          }
          if (res.status === 404) {
            throw new Error('The requested object does not exist or was deleted.');
          }
          throw new Error(`Failed to load object metadata (HTTP ${res.status})`);
        }
        const ct = res.headers.get('content-type') || '';
        const cl = res.headers.get('content-length');
        setContentType(ct);
        if (cl) {
          setFileSize(parseInt(cl, 10) || 0);
        }
      })
      .catch((err) => {
        setMetaError(err instanceof Error ? err.message : 'Failed to inspect object');
      })
      .finally(() => {
        setIsLoadingMeta(false);
      });
  }, [params]);

  if (!params && isLoadingMeta) {
    return (
      <div className="min-h-screen bg-[#070707] text-white flex items-center justify-center font-sans">
        <div className="flex items-center gap-3 text-[#8c8c8c] text-[14px]">
          <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span>Loading secure capability viewer...</span>
        </div>
      </div>
    );
  }

  if (metaError || !params) {
    return (
      <div className="min-h-screen bg-[#070707] text-white flex flex-col items-center justify-center p-6 font-sans">
        <div className="max-w-md w-full bg-[#0d0d0d] border border-[#222222] rounded-2xl p-8 text-center shadow-2xl space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-red-950/30 border border-red-900/50 flex items-center justify-center mx-auto text-red-400">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h2 className="text-[18px] font-semibold text-white">Link Unavailable</h2>
          <p className="text-[13px] text-[#8c8c8c] leading-relaxed">
            {metaError || 'Unable to load capability share link.'}
          </p>
          <div className="pt-2">
            <a
              href="/system"
              className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-[#1a1a1a] hover:bg-[#242424] text-white text-[13px] border border-[#2e2e2e] transition-colors"
            >
              Return to Axiom
            </a>
          </div>
        </div>
      </div>
    );
  }

  const fileName = params.key.split('/').pop() || params.key;
  const streamUrl = `/api/v1/blobs/${encodeURIComponent(params.namespace)}/${encodeURIComponent(params.key)}?ticket_sig=${encodeURIComponent(params.ticket_sig)}&ticket_exp=${encodeURIComponent(params.ticket_exp)}&inline=1`;
  const downloadUrl = `/api/v1/blobs/${encodeURIComponent(params.namespace)}/${encodeURIComponent(params.key)}?ticket_sig=${encodeURIComponent(params.ticket_sig)}&ticket_exp=${encodeURIComponent(params.ticket_exp)}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Expiration calculation
  const now = Math.floor(Date.now() / 1000);
  const remainingSecs = Math.max(0, params.ticket_exp - now);
  const remainingHours = Math.floor(remainingSecs / 3600);
  const remainingMins = Math.floor((remainingSecs % 3600) / 60);

  return (
    <div className="min-h-screen bg-[#070707] text-white flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      {/* ─── Header: Fixed Navigation Bar ─────────────── */}
      <header className="h-14 border-b border-[#1c1c1c] bg-[#0c0c0c]/80 backdrop-blur-md sticky top-0 z-40 px-4 md:px-8 flex items-center justify-between">
        {/* Brand & File Information */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 pr-3 border-r border-[#222222]">
            <div className="w-7 h-7 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <HardDrive className="w-4 h-4" />
            </div>
            <span className="text-[14px] font-semibold text-white tracking-tight hidden sm:inline">Axiom</span>
          </div>

          <div className="flex items-center gap-2 min-w-0">
            {getFileIcon(fileName, 'w-4 h-4')}
            <span className="text-[14px] font-medium text-white truncate max-w-[200px] sm:max-w-xs md:max-w-md" title={fileName}>
              {fileName}
            </span>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#181818] border border-[#262626] text-[#8c8c8c] hidden md:inline">
              {getFileExtension(fileName)}
            </span>
          </div>
        </div>

        {/* Right Actions: Capability status, Copy link, Download */}
        <div className="flex items-center gap-2.5">
          {params.ticket_exp > 0 && (
            <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#141414] border border-[#242424] text-[12px] font-mono text-[#8c8c8c]">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>
                Expires in {remainingHours}h {remainingMins}m
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={handleCopyLink}
            title="Copy share link"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1f1f1f] border border-[#262626] transition-colors cursor-pointer"
          >
            {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isCopied ? 'Copied' : 'Copy Link'}</span>
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-[13px] font-medium text-black bg-white hover:bg-[#e0e0e0] shadow-sm transition-all transform active:scale-95 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Download</span>
          </button>
        </div>
      </header>

      {/* ─── Main Viewport Canvas ─────────────── */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 md:p-8 max-w-7xl w-full mx-auto">
        <div className="w-full">
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

      {/* ─── Footer: Security & Capability Telemetry ─────────────── */}
      <footer className="border-t border-[#1a1a1a] bg-[#090909] py-3 px-4 md:px-8 text-[12px] text-[#777777] font-mono flex flex-col sm:flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Cryptographically signed read capability token</span>
        </div>

        <div className="flex items-center gap-3">
          <span>Namespace: {params.namespace}</span>
          <span>&bull;</span>
          <span>{formatBytes(fileSize)}</span>
        </div>
      </footer>
    </div>
  );
}
