/*
 * Minimal sleek empty states for Storage explorer.
 * Owned by: ui/pages/storage
 * Design reference: TableEditor empty state & Vercel minimal void dark
 */

import React from 'react';
import { HardDrive, FolderOpen, Search, Plus, Upload } from 'lucide-react';

interface StorageEmptyStateProps {
  type: 'no-namespaces' | 'no-namespace-selected' | 'empty-folder' | 'no-search-results';
  searchQuery?: string;
  onCreateNamespace?: () => void;
  onUpload?: () => void;
  onClearSearch?: () => void;
}

export function StorageEmptyState({
  type,
  searchQuery,
  onCreateNamespace,
  onUpload,
  onClearSearch,
}: StorageEmptyStateProps) {
  if (type === 'no-namespaces') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center select-none font-sans">
        <div className="w-12 h-12 rounded-[10px] bg-[#141414] border border-[#242424] flex items-center justify-center mb-3.5">
          <HardDrive className="w-6 h-6 text-[#8c8c8c]" />
        </div>
        <h4 className="text-[16px] font-medium text-white mb-1.5">No Storage Namespaces</h4>
        <p className="text-[13.5px] text-[#8c8c8c] max-w-sm mb-5 leading-relaxed">
          Namespaces isolate content-addressed blobs and enforce dedicated byte quotas.
        </p>
        {onCreateNamespace && (
          <button
            type="button"
            onClick={onCreateNamespace}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-[8px] text-[13.5px] font-medium text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create Namespace</span>
          </button>
        )}
      </div>
    );
  }

  if (type === 'no-namespace-selected') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center select-none font-sans">
        <div className="w-12 h-12 rounded-[10px] bg-[#141414] border border-[#242424] flex items-center justify-center mb-3.5">
          <HardDrive className="w-6 h-6 text-[#8c8c8c]" />
        </div>
        <h4 className="text-[16px] font-medium text-white mb-1.5">Select a Namespace</h4>
        <p className="text-[13.5px] text-[#8c8c8c] max-w-xs leading-relaxed">
          Choose a storage namespace from the left sidebar to explore and manage objects.
        </p>
      </div>
    );
  }

  if (type === 'no-search-results') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center select-none font-sans">
        <div className="w-12 h-12 rounded-[10px] bg-[#141414] border border-[#242424] flex items-center justify-center mb-3.5">
          <Search className="w-6 h-6 text-[#8c8c8c]" />
        </div>
        <h4 className="text-[16px] font-medium text-white mb-1.5">No Matching Files</h4>
        <p className="text-[13.5px] text-[#8c8c8c] max-w-xs mb-5 leading-relaxed">
          No objects matched "{searchQuery}". Try adjusting your keywords or filters.
        </p>
        {onClearSearch && (
          <button
            type="button"
            onClick={onClearSearch}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-[8px] text-[13.5px] font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#242424] hover:border-[#383838] transition-colors cursor-pointer"
          >
            Clear Search
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-12 text-center select-none font-sans">
      <div className="w-12 h-12 rounded-[10px] bg-[#141414] border border-[#242424] flex items-center justify-center mb-3.5">
        <FolderOpen className="w-6 h-6 text-[#8c8c8c]" />
      </div>
      <h4 className="text-[16px] font-medium text-white mb-1.5">This directory is empty</h4>
      <p className="text-[13.5px] text-[#8c8c8c] max-w-xs mb-5 leading-relaxed">
        Drop files here to upload, or use the Upload button to store content-addressed blobs.
      </p>
      {onUpload && (
        <button
          type="button"
          onClick={onUpload}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-[8px] text-[13.5px] font-medium text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5 text-[#8c8c8c]" />
          <span>Upload File</span>
        </button>
      )}
    </div>
  );
}
