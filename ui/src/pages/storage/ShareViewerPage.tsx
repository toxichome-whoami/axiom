/*
 * Axiom Standalone Media & Capability Share Viewer Page.
 * Renders an industrial-grade media preview for capability links and Public CDN objects.
 * Public route (accessible without active admin session).
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
  Globe,
} from 'lucide-react';
import { MediaPlayer } from './MediaPlayer';
import { formatBytes } from './format';
import { getFileIcon, getFileExtension } from './fileIcon';

export function ShareViewerPage() {
  const [params, setParams] = useState<{
    namespace: string;
    key: string;
    ticket_sig?: string;
    ticket_exp?: number;
    isPublic?: boolean;
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

    if (!ns || !key) {
      setMetaError('Incomplete parameters. Missing namespace or file key.');
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
    const sanitizedKey = key.split('/').map(encodeURIComponent).join('/');
    const publicHeadUrl = `/api/v1/blobs/public/${encodeURIComponent(ns)}/${sanitizedKey}?inline=1`;

    fetch(publicHeadUrl, { method: 'HEAD' })
      .then((res) => {
        if (!res.ok) {
          throw new Error('This object is private and requires a valid capability ticket signature.');
        }
        const ct = res.headers.get('content-type') || '';
        const cl = res.headers.get('content-length');
        setContentType(ct);
        if (cl) setFileSize(parseInt(cl, 10) || 0);

        setParams({
          namespace: ns,
          key,
          isPublic: true,
        });
      })
      .catch((err) => {
        setMetaError(err instanceof Error ? err.message : 'Object unavailable');
      })
      .finally(() => {
        setIsLoadingMeta(false);
      });
  }, []);

  // Fetch HEAD metadata for signed capability tickets
  useEffect(() => {
    if (!params || params.isPublic) return;

    const nowSecs = Math.floor(Date.now() / 1000);
    if (params.ticket_exp && params.ticket_exp > 0 && nowSecs > params.ticket_exp) {
      setMetaError('This capability share link has expired. Please request a new link from the owner.');
      setIsLoadingMeta(false);
      return;
    }

    const headUrl = `/api/v1/blobs/${encodeURIComponent(params.namespace)}/${encodeURIComponent(params.key)}?ticket_sig=${encodeURIComponent(params.ticket_sig || '')}&ticket_exp=${encodeURIComponent(params.ticket_exp || 0)}&inline=1`;

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
      <div className="min-h-screen bg-[#09090b] text-white flex items-center justify-center font-sans">
        <div className="flex items-center gap-3 text-[#8c8c8c] text-[13px]">
          <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span>Loading media preview...</span>
        </div>
      </div>
    );
  }

  if (metaError || !params) {
    return (
      <div className="min-h-screen bg-[#09090b] text-white flex flex-col items-center justify-center p-6 font-sans">
        <div className="max-w-md w-full bg-[#0c0c0c] border border-[#262626] rounded-[8px] p-6 text-center shadow-2xl space-y-3 font-sans">
          <div className="w-10 h-10 rounded-[6px] bg-red-950/30 border border-red-900/50 flex items-center justify-center mx-auto text-red-400">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <h2 className="text-[16px] font-sans font-medium text-white tracking-tight">Link Unavailable</h2>
          <p className="text-[13px] text-[#8c8c8c] leading-relaxed">
            {metaError || 'Unable to load capability share link.'}
          </p>
          <div className="pt-2">
            <a
              href="/system"
              className="inline-flex items-center justify-center h-8 px-4 rounded-[6px] bg-[#141414] hover:bg-[#1a1a1a] text-white text-[13px] font-medium border border-[#262626] transition-colors"
            >
              Return to Axiom
            </a>
          </div>
        </div>
      </div>
    );
  }

  const fileName = params.key.split('/').pop() || params.key;
  const sanitizedKey = params.key.split('/').map(encodeURIComponent).join('/');

  const streamUrl = params.isPublic
    ? `/api/v1/blobs/public/${encodeURIComponent(params.namespace)}/${sanitizedKey}?inline=1`
    : `/api/v1/blobs/${encodeURIComponent(params.namespace)}/${encodeURIComponent(params.key)}?ticket_sig=${encodeURIComponent(params.ticket_sig || '')}&ticket_exp=${encodeURIComponent(params.ticket_exp || 0)}&inline=1`;

  const downloadUrl = params.isPublic
    ? `/api/v1/blobs/public/${encodeURIComponent(params.namespace)}/${sanitizedKey}`
    : `/api/v1/blobs/${encodeURIComponent(params.namespace)}/${encodeURIComponent(params.key)}?ticket_sig=${encodeURIComponent(params.ticket_sig || '')}&ticket_exp=${encodeURIComponent(params.ticket_exp || 0)}`;

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

  const now = Math.floor(Date.now() / 1000);
  const remainingSecs = Math.max(0, (params.ticket_exp || 0) - now);
  const remainingHours = Math.floor(remainingSecs / 3600);
  const remainingMins = Math.floor((remainingSecs % 3600) / 60);

  return (
    <div className="min-h-screen bg-[#09090b] text-white flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      {/* ─── Header: Navigation Bar ─────────────── */}
      <header className="h-12 border-b border-[#1f1f1f] bg-[#0c0c0c] sticky top-0 z-40 px-4 md:px-6 flex items-center justify-between">
        {/* Brand & File Information */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex items-center gap-2 pr-2.5 border-r border-[#222222]">
            <div className="w-6 h-6 rounded-[5px] bg-[#141414] border border-[#262626] flex items-center justify-center text-white">
              <HardDrive className="w-3.5 h-3.5" />
            </div>
            <span className="text-[13px] font-sans font-medium text-white tracking-tight hidden sm:inline">Axiom</span>
          </div>

          <div className="flex items-center gap-2 min-w-0">
            {getFileIcon(fileName, 'w-3.5 h-3.5')}
            <span className="text-[13px] font-sans font-medium text-white truncate max-w-[200px] sm:max-w-xs md:max-w-md" title={fileName}>
              {fileName}
            </span>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded-[4px] bg-[#141414] border border-[#262626] text-[#8c8c8c] hidden md:inline">
              {getFileExtension(fileName)}
            </span>
            {params.isPublic && (
              <span className="px-1.5 py-0.5 rounded-[4px] text-[11px] font-medium bg-[#161616] border border-[#2e2e2e] text-[#cccccc] leading-none hidden sm:inline">
                Public CDN
              </span>
            )}
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          {!params.isPublic && params.ticket_exp && params.ticket_exp > 0 && (
            <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[#141414] border border-[#242424] text-[11px] font-mono text-[#8c8c8c]">
              <Clock className="w-3 h-3 text-amber-400" />
              <span>
                Expires in {remainingHours}h {remainingMins}m
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={handleCopyLink}
            title="Copy share link"
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[6px] text-[12px] font-sans text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] transition-colors cursor-pointer"
          >
            {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isCopied ? 'Copied' : 'Copy Link'}</span>
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-[6px] text-[12px] font-sans font-medium text-black bg-white hover:bg-[#e0e0e0] shadow-xs transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Download</span>
          </button>
        </div>
      </header>

      {/* ─── Main Viewport Canvas ─────────────── */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 max-w-6xl w-full mx-auto">
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

      {/* ─── Footer: Telemetry ─────────────── */}
      <footer className="border-t border-[#1f1f1f] bg-[#0c0c0c] py-2.5 px-4 md:px-6 text-[12px] text-[#737373] font-mono flex flex-col sm:flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {params.isPublic ? (
            <>
              <Globe className="w-3.5 h-3.5 text-emerald-400" />
              <span>Permanent Public CDN Object &bull; Zero Ticket Overhead</span>
            </>
          ) : (
            <>
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Cryptographically signed capability ticket</span>
            </>
          )}
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
