/*
 * Floating bottom-right upload progress drawer modeled after Google Drive / OneDrive.
 * Owned by: ui/pages/storage
 * Dependencies: lucide-react, ./fileIcon, ./format
 * Invariants: Operates non-blockingly in the background; allows collapsing, cancelling, and dismissing.
 */

import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  X,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Loader2,
} from 'lucide-react';
import { getFileIcon } from './fileIcon';
import { formatBytes } from './format';

export interface UploadTask {
  id: string;
  name: string;
  size: number;
  key: string;
  namespace: string;
  status: 'pending' | 'uploading' | 'completed' | 'failed' | 'cancelled';
  error?: string;
  abortController?: AbortController;
}

interface UploadProgressDrawerProps {
  tasks: UploadTask[];
  onCancelAll: () => void;
  onCancelTask: (id: string) => void;
  onDismiss: () => void;
}

/**
 * Renders an asynchronous bottom-docked upload tray reflecting active and completed uploads.
 */
export function UploadProgressDrawer({
  tasks,
  onCancelAll,
  onCancelTask,
  onDismiss,
}: UploadProgressDrawerProps) {
  const [isMinimized, setIsMinimized] = useState(false);

  if (tasks.length === 0) return null;

  const uploadingCount = tasks.filter((t) => t.status === 'uploading' || t.status === 'pending').length;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const failedCount = tasks.filter((t) => t.status === 'failed').length;
  const isAllDone = uploadingCount === 0;

  // Header Title
  let title = `Uploading ${uploadingCount} item${uploadingCount > 1 ? 's' : ''}`;
  if (isAllDone) {
    if (failedCount > 0 && completedCount > 0) {
      title = `${completedCount} uploaded, ${failedCount} failed`;
    } else if (failedCount > 0) {
      title = `${failedCount} upload${failedCount > 1 ? 's' : ''} failed`;
    } else {
      title = `${completedCount} upload${completedCount > 1 ? 's' : ''} complete`;
    }
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-80 sm:w-96 rounded-xl border border-[#2b2b2b] bg-[#141414] shadow-2xl overflow-hidden font-sans select-none animate-in fade-in slide-in-from-bottom-2 duration-150 ring-1 ring-blue-500/20"
      role="region"
      aria-label="Upload progress"
    >
      {/* ─── Top Header Bar ────────────────────────────────────────────── */}
      <div className="h-11 px-3.5 bg-[#181818] border-b border-[#242424] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-medium text-white truncate">{title}</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setIsMinimized(!isMinimized)}
            className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#9ca3af] hover:text-white hover:bg-[#242424] transition-colors cursor-pointer"
            title={isMinimized ? 'Expand' : 'Collapse'}
            aria-label={isMinimized ? 'Expand upload drawer' : 'Collapse upload drawer'}
          >
            {isMinimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="w-7 h-7 flex items-center justify-center rounded-[6px] text-[#9ca3af] hover:text-white hover:bg-[#242424] transition-colors cursor-pointer"
            title="Dismiss"
            aria-label="Dismiss upload drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ─── Collapsible Tray Body ───────────────────────────────────────── */}
      {!isMinimized && (
        <>
          {/* Subheader status bar */}
          <div className="h-9 px-3.5 bg-[#151515] border-b border-[#222222] flex items-center justify-between text-[12px]">
            <span className="text-[#8c8c8c] truncate">
              {uploadingCount > 0
                ? completedCount > 0
                  ? `Uploaded ${completedCount} of ${tasks.length}...`
                  : 'Starting upload...'
                : isAllDone && failedCount === 0
                ? 'All files saved to storage'
                : 'Upload finished with warnings'}
            </span>
            {uploadingCount > 0 ? (
              <button
                type="button"
                onClick={onCancelAll}
                className="text-[#60a5fa] hover:text-[#93c5fd] hover:underline font-medium text-[12px] cursor-pointer transition-colors shrink-0 ml-2"
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={onDismiss}
                className="text-[#8c8c8c] hover:text-white text-[12px] cursor-pointer transition-colors shrink-0 ml-2"
              >
                Clear
              </button>
            )}
          </div>

          {/* Upload Queue Item List */}
          <div className="max-h-56 overflow-y-auto divide-y divide-[#1c1c1c] bg-[#141414]">
            {tasks.map((task) => {
              const fileIcon = getFileIcon(task.name);

              return (
                <div
                  key={task.id}
                  className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-[#181818] transition-colors"
                >
                  {/* Left: Icon and file name */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className="shrink-0">{fileIcon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-[#e5e7eb] truncate font-normal" title={task.name}>
                        {task.name}
                      </div>
                      <div className="text-[11px] text-[#71717a] flex items-center gap-1.5 truncate">
                        <span>{formatBytes(task.size)}</span>
                        {task.status === 'failed' && (
                          <span className="text-[#ef4444] truncate">
                            • {task.error || 'Failed'}
                          </span>
                        )}
                        {task.status === 'cancelled' && (
                          <span className="text-[#a1a1aa]">• Cancelled</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Progress indicator / Action */}
                  <div className="shrink-0 flex items-center">
                    {task.status === 'uploading' && (
                      <div className="relative w-4 h-4 flex items-center justify-center" title="Uploading...">
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-[#3f3f46] border-t-white animate-spin" />
                      </div>
                    )}

                    {task.status === 'pending' && (
                      <span title="Queued">
                        <div className="w-3.5 h-3.5 rounded-full border border-[#3f3f46] border-dashed" />
                      </span>
                    )}

                    {task.status === 'completed' && (
                      <span title="Completed">
                        <CheckCircle2 className="w-4 h-4 text-[#22c55e]" />
                      </span>
                    )}

                    {task.status === 'failed' && (
                      <span title={task.error || 'Failed'}>
                        <AlertCircle className="w-4 h-4 text-[#ef4444]" />
                      </span>
                    )}

                    {task.status === 'cancelled' && (
                      <span title="Cancelled">
                        <XCircle className="w-4 h-4 text-[#71717a]" />
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
