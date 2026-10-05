/*
 * Drive-style destination picker modal for moving files and directories across hierarchies.
 * Owned by: ui/pages/storage
 * Key deps: ../../types, ../../components/ui/Button, ../../components/shared/CustomSelect, ./paths
 * Invariants: Blocks moving a folder into its own subtree; cleans trailing slashes.
 * Last structural change: Extracted from monolithic Storage.tsx.
 */

import React, { useState } from 'react';
import { Folder, X, AlertTriangle, ArrowRight } from 'lucide-react';
import { NamespaceInfo } from '../../types';
import { StorageItem } from './types';
import { CustomSelect } from '../../components/shared/CustomSelect';
import { Button } from '../../components/ui/Button';
import { sanitizeFolder, isSelfOrDescendant, joinKey } from './paths';

interface MoveDialogProps {
  isOpen: boolean;
  item: StorageItem | null;
  currentNamespace: string;
  namespaces: NamespaceInfo[];
  availableFolders: string[];
  onClose: () => void;
  onMove: (destNs: string, destKey: string) => Promise<void>;
}

export const MoveDialog: React.FC<MoveDialogProps> = ({
  isOpen,
  item,
  currentNamespace,
  namespaces,
  availableFolders,
  onClose,
  onMove,
}) => {
  const [targetNs, setTargetNs] = useState(currentNamespace);
  const [targetFolder, setTargetFolder] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen || !item) return null;

  const isFolder = item.type === 'folder';
  const cleanDir = sanitizeFolder(targetFolder);
  const destKey = joinKey(cleanDir, item.name, isFolder);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (targetNs === currentNamespace && destKey === item.fullKey) {
      setError('Destination path is identical to the current location.');
      return;
    }

    if (isFolder && targetNs === currentNamespace && isSelfOrDescendant(item.fullKey, destKey)) {
      setError('Cannot move a directory into itself or one of its child directories.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onMove(targetNs, destKey);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to move item');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs font-sans">
      <div className="w-full max-w-md rounded-[10px] bg-[#0e0e0e] border border-[#262626] p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Folder className="w-4 h-4 text-[#eab308]" />
            <h3 className="text-[14px] font-medium text-white">
              Move {isFolder ? 'Folder' : 'Object'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#777777] hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-2.5 rounded-[6px] bg-[#ef4444]/10 border border-[#ef4444]/30 text-[12px] text-[#ef4444] flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[12px] text-[#cccccc] font-medium mb-1.5">
              Target Namespace
            </label>
            <CustomSelect
              value={targetNs}
              options={namespaces.map((n) => ({
                value: n.name,
                label: `${n.name} (${n.total_objects} items)`,
              }))}
              onChange={(val) => {
                setTargetNs(val);
                setError(null);
              }}
              size="sm"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[12px] text-[#cccccc] font-medium">
                Destination Folder Path
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setTargetFolder('')}
                  className="text-[11px] text-[#8c8c8c] hover:text-white px-1.5 py-0.5 rounded bg-[#1c1c1c] border border-[#2a2a2a] cursor-pointer"
                >
                  Root (/)
                </button>
              </div>
            </div>

            <input
              type="text"
              value={targetFolder}
              onChange={(e) => {
                setTargetFolder(e.target.value);
                setError(null);
              }}
              placeholder="e.g. documents/archive/ (blank for root)"
              className="w-full h-8 px-3 rounded-[6px] bg-[#141414] border border-[#262626] focus:border-[#383838] text-white text-[13px] outline-none"
            />

            {availableFolders.length > 0 && (
              <div className="mt-2 space-y-1">
                <span className="text-[11px] text-[#777777] block">Quick folder picker:</span>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                  {availableFolders.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setTargetFolder(f)}
                      className="text-[11px] text-[#cccccc] hover:text-white px-2 py-0.5 rounded bg-[#181818] border border-[#262626] hover:border-[#383838] cursor-pointer"
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Destination Preview */}
          <div className="p-2.5 rounded-[6px] bg-[#080808] border border-[#222222] text-[12px] space-y-1">
            <span className="text-[#666666] block text-[11px]">Resulting Location:</span>
            <div className="text-white flex items-center gap-1.5 truncate">
              <span className="text-[#cccccc]">{targetNs}</span>
              <span className="text-[#555555]">/</span>
              <span className="truncate">{destKey}</span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isLoading={isSubmitting}
            >
              <ArrowRight className="w-3.5 h-3.5 mr-1" />
              Move Here
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
