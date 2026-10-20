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
        <div className="w-10 h-10 rounded-md bg-[#141414] border border-[#242424] flex items-center justify-center mb-3">
          <HardDrive className="w-5 h-5 text-[#8c8c8c]" />
        </div>
        <h4 className="text-sm font-medium text-white mb-1">No Storage Namespaces</h4>
        <p className="text-xs text-[#8c8c8c] max-w-sm mb-4 leading-relaxed">
          Namespaces isolate content-addressed blobs and enforce dedicated byte quotas.
        </p>
        {onCreateNamespace && (
          <button
            type="button"
            onClick={onCreateNamespace}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer"
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
        <div className="w-10 h-10 rounded-md bg-[#141414] border border-[#242424] flex items-center justify-center mb-3">
          <HardDrive className="w-5 h-5 text-[#8c8c8c]" />
        </div>
        <h4 className="text-sm font-medium text-white mb-1">Select a Namespace</h4>
        <p className="text-xs text-[#8c8c8c] max-w-xs leading-relaxed">
          Choose a storage namespace from the left sidebar to explore and manage objects.
        </p>
      </div>
    );
  }

  if (type === 'no-search-results') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center select-none font-sans">
        <div className="w-10 h-10 rounded-md bg-[#141414] border border-[#242424] flex items-center justify-center mb-3">
          <Search className="w-5 h-5 text-[#8c8c8c]" />
        </div>
        <h4 className="text-sm font-medium text-white mb-1">No Matching Files</h4>
        <p className="text-xs text-[#8c8c8c] max-w-xs mb-4 leading-relaxed">
          No objects matched "{searchQuery}". Try adjusting your keywords or filters.
        </p>
        {onClearSearch && (
          <button
            type="button"
            onClick={onClearSearch}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium text-[#cccccc] hover:text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#242424] hover:border-[#383838] transition-colors cursor-pointer"
          >
            Clear Search
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-12 text-center select-none font-sans">
      <div className="w-10 h-10 rounded-md bg-[#141414] border border-[#242424] flex items-center justify-center mb-3">
        <FolderOpen className="w-5 h-5 text-[#8c8c8c]" />
      </div>
      <h4 className="text-sm font-medium text-white mb-1">This directory is empty</h4>
      <p className="text-xs text-[#8c8c8c] max-w-xs mb-4 leading-relaxed">
        Drop files here to upload, or use the Upload button to store content-addressed blobs.
      </p>
      {onUpload && (
        <button
          type="button"
          onClick={onUpload}
          className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-md text-xs font-medium text-white bg-[#141414] hover:bg-[#1c1c1c] border border-[#262626] hover:border-[#383838] transition-colors cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5 text-[#8c8c8c]" />
          <span>Upload File</span>
        </button>
      )}
    </div>
  );
}
