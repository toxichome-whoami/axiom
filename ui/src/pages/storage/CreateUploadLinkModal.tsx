/*
 * Modal for creating pre-signed WRITE upload capability tickets for external users/clients.
 * Owned by: ui/pages/storage
 * Key deps: ../../types, ../../api/client, ../../components/ui/Button
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  Upload,
  Copy,
  Check,
  Clock,
  AlertTriangle,
  Code2,
  FileUp,
} from 'lucide-react';
import { CreateBlobTicketResponse } from '../../types';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';

export interface CreateUploadLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  namespace: string;
  currentPrefix: string;
}

const TTL_PRESETS = [
  { label: '1 hour', seconds: 3600 },
  { label: '6 hours', seconds: 21600 },
  { label: '24 hours', seconds: 86400 },
  { label: '7 days', seconds: 604800 },
  { label: 'Custom', seconds: 0 },
];

export function CreateUploadLinkModal({
  isOpen,
  onClose,
  namespace,
  currentPrefix,
}: CreateUploadLinkModalProps) {
  const [fileName, setFileName] = useState('');
  const [selectedTtl, setSelectedTtl] = useState<number>(3600);
  const [customHours, setCustomHours] = useState<string>('12');

  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [generatedTicket, setGeneratedTicket] = useState<CreateBlobTicketResponse | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setFileName('');
      setCreateError(null);
      setGeneratedTicket(null);
      setSelectedTtl(3600);
      setCustomHours('12');
    }
  }, [isOpen]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === id ? null : prev));
    }, 2000);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = fileName.trim().replace(/^[/\\]+/, '');
    if (!cleanName) {
      setCreateError('Please enter a destination file name');
      return;
    }

    let ttl = selectedTtl;
    if (ttl === 0) {
      const parsed = parseFloat(customHours);
      if (isNaN(parsed) || parsed <= 0) {
        setCreateError('Please enter a valid duration in hours');
        return;
      }
      ttl = Math.round(parsed * 3600);
    }

    if (ttl < 60 || ttl > 86400 * 30) {
      setCreateError('Duration must be between 1 minute and 30 days');
      return;
    }

    const fullKey = `${currentPrefix}${cleanName}`;

    setIsCreating(true);
    setCreateError(null);

    try {
      const res = await api.createBlobTicket(namespace, fullKey, 'WRITE', ttl);
      setGeneratedTicket(res);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to generate upload link');
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  const fullUploadUrl = generatedTicket
    ? `${window.location.origin}${generatedTicket.url || ''}`
    : '';

  const cleanTargetName = fileName.trim().replace(/^[/\\]+/, '') || 'my-file.bin';
  const curlUploadSnippet = fullUploadUrl
    ? `curl -X PUT --upload-file "${cleanTargetName}" "${fullUploadUrl}"`
    : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[520px] rounded-[8px] bg-[#0c0c0c] border border-[#262626] shadow-2xl overflow-hidden font-sans flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f1f1f]">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-blue-400" />
            <h3 className="text-[15px] font-sans font-medium text-white tracking-tight">
              Create Upload Link
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#8c8c8c] hover:text-white transition-colors cursor-pointer p-1 rounded-[6px] hover:bg-[#1a1a1a]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {generatedTicket ? (
            /* ─── Success Generated View ───────────────────────────────── */
            <div className="space-y-4 animate-in fade-in duration-100">
              <div>
                <label className="block text-[13px] font-sans font-medium text-[#8c8c8c] mb-1.5">
                  Pre-Signed Upload URL (HTTP PUT)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={fullUploadUrl}
                    className="flex-1 h-8 px-3 rounded-[6px] bg-[#141414] border border-[#262626] text-white font-mono text-[12px] select-all outline-none"
                  />
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => copyToClipboard(fullUploadUrl, 'upload-url')}
                    className="h-8 px-3"
                  >
                    {copiedKey === 'upload-url' ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-[12px] font-sans text-[#666666] mt-1.5">
                  External clients or scripts can upload this file via HTTP PUT without an API key.
                </p>
              </div>

              {/* cURL Snippet Card */}
              <div className="p-3 rounded-[6px] bg-[#121212] border border-[#222222] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[12px] font-sans font-medium text-[#cccccc]">
                    <Code2 className="w-3.5 h-3.5 text-blue-400" />
                    <span>cURL Upload Snippet</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(curlUploadSnippet, 'curl-upload')}
                    className="h-6 px-2 rounded-[4px] bg-[#181818] hover:bg-[#222222] border border-[#2a2a2a] text-[11px] font-sans font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer"
                  >
                    {copiedKey === 'curl-upload' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="p-2 rounded-[4px] bg-[#0a0a0a] border border-[#1e1e1e] text-[11px] font-mono text-[#a3a3a3] overflow-x-auto whitespace-pre-wrap break-all select-all">
                  {curlUploadSnippet}
                </pre>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setGeneratedTicket(null)}
                  className="text-[13px] font-sans text-[#8c8c8c] hover:text-white transition-colors cursor-pointer"
                >
                  ← Create another link
                </button>
                <Button type="button" variant="secondary" size="sm" onClick={onClose} className="h-8 px-3">
                  Done
                </Button>
              </div>
            </div>
          ) : (
            /* ─── Form ─────────────────────────────────────────────────── */
            <form onSubmit={handleCreate} className="space-y-4">
              {createError && (
                <div className="p-2.5 rounded-[6px] bg-[#ef4444]/10 border border-[#ef4444]/30 text-[13px] font-sans text-[#ef4444] flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{createError}</span>
                </div>
              )}

              {/* Destination File Name */}
              <div>
                <label className="block text-[13px] font-sans font-medium text-[#8c8c8c] mb-1.5">
                  Destination File Name
                </label>
                <div className="flex items-center rounded-[6px] bg-[#141414] border border-[#262626] focus-within:border-[#3b82f6] overflow-hidden">
                  {currentPrefix && (
                    <span className="px-2.5 py-1.5 text-[12px] font-mono text-[#666666] bg-[#101010] border-r border-[#222222] shrink-0">
                      {currentPrefix}
                    </span>
                  )}
                  <input
                    type="text"
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    placeholder="e.g. video_v1.mp4"
                    autoFocus
                    className="flex-1 h-8 px-2.5 bg-transparent text-white text-[13px] font-sans outline-none placeholder:text-[#555555]"
                  />
                </div>
                <p className="text-[12px] font-sans text-[#666666] mt-1.5">
                  The upload link will be cryptographically locked to this exact file name in{' '}
                  <span className="font-mono text-[#8c8c8c]">{namespace}</span>.
                </p>
              </div>

              {/* Expiration Segmented Control */}
              <div>
                <label className="block text-[13px] font-sans font-medium text-[#8c8c8c] mb-1.5">
                  Link Expiration
                </label>
                <div className="grid grid-cols-5 gap-1 p-1 bg-[#141414] border border-[#262626] rounded-[6px]">
                  {TTL_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setSelectedTtl(preset.seconds)}
                      className={`h-8 rounded-[5px] text-[13px] font-sans font-medium transition-colors cursor-pointer flex items-center justify-center ${
                        selectedTtl === preset.seconds
                          ? 'bg-[#222222] text-white shadow-xs'
                          : 'text-[#8c8c8c] hover:text-white'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                {selectedTtl === 0 && (
                  <div className="mt-2.5 flex items-center gap-2">
                    <input
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={customHours}
                      onChange={(e) => setCustomHours(e.target.value)}
                      placeholder="12"
                      className="w-24 h-8 px-2.5 rounded-[6px] bg-[#141414] border border-[#262626] focus:border-[#3b82f6] text-white text-[13px] font-sans outline-none"
                    />
                    <span className="text-[13px] font-sans text-[#8c8c8c]">hours</span>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1a1a1a]">
                <Button type="button" variant="secondary" size="sm" onClick={onClose} className="h-8 px-3">
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  isLoading={isCreating}
                  disabled={isCreating}
                  className="h-8 px-4"
                >
                  Generate Upload Link
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
