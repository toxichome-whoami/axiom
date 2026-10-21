/*
 * Drive-style destination picker modal for moving files and directories across hierarchies.
 * Owned by: ui/pages/storage
 * Key deps: ../../types, ../../components/ui/Button, ../../components/shared/CustomSelect, ./paths
 * Invariants: Blocks moving a folder into its own subtree; cleans trailing slashes.
 * Last structural change: Extracted from monolithic Storage.tsx.
 */

import React, { useState } from 'react';
import { Folder, X, AlertTriangle, ArrowRight, Copy } from 'lucide-react';
import { NamespaceInfo } from '../../types';
import { StorageItem } from './types';
import { CustomSelect } from '../../components/shared/CustomSelect';
import { Button } from '../../components/ui/Button';
import { sanitizeFolder, isSelfOrDescendant, joinKey } from './paths';

interface MoveDialogProps {
  isOpen: boolean;
  mode?: 'move' | 'copy';
  item?: StorageItem | null;
  items?: StorageItem[] | null;
  currentNamespace: string;
  namespaces: NamespaceInfo[];
  availableFolders: string[];
  onClose: () => void;
  onMove?: (destNs: string, destKey: string) => Promise<void>;
  onBatchMove?: (destNs: string, targetFolder: string, items: StorageItem[]) => Promise<void>;
}

export const MoveDialog: React.FC<MoveDialogProps> = ({
  isOpen,
  mode = 'move',
  item,
  items,
  currentNamespace,
  namespaces,
  availableFolders,
  onClose,
  onMove,
  onBatchMove,
}) => {
  const isCopy = mode === 'copy';
  const actionWord = isCopy ? 'copy' : 'move';
  const ActionWord = isCopy ? 'Copy' : 'Move';
  const [targetNs, setTargetNs] = useState(currentNamespace);
  const [targetFolder, setTargetFolder] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  const activeItems = items && items.length > 0 ? items : item ? [item] : [];
  if (!isOpen || activeItems.length === 0) return null;

  const isMultiple = activeItems.length > 1;
  const singleItem = !isMultiple ? activeItems[0] : null;
  const isFolder = singleItem ? singleItem.type === 'folder' : false;
  const cleanDir = sanitizeFolder(targetFolder);
  const destKey = singleItem ? joinKey(cleanDir, singleItem.name, isFolder) : cleanDir;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isMultiple) {
      for (const it of activeItems) {
        const itemDestKey = joinKey(cleanDir, it.name, it.type === 'folder');
        if (targetNs === currentNamespace && itemDestKey === it.fullKey) {
          setError(`Item "${it.name}" is already at the target location.`);
          return;
        }
        if (it.type === 'folder' && targetNs === currentNamespace && isSelfOrDescendant(it.fullKey, itemDestKey)) {
          setError(`Cannot ${actionWord} directory "${it.name}" into itself or a child directory.`);
          return;
        }
      }

      setIsSubmitting(true);
      try {
        if (onBatchMove) {
          await onBatchMove(targetNs, cleanDir, activeItems);
        } else if (onMove) {
          for (const it of activeItems) {
            const itemDest = joinKey(cleanDir, it.name, it.type === 'folder');
            await onMove(targetNs, itemDest);
          }
        }
        onClose();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : `Failed to ${actionWord} items`);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (!singleItem) return;

    if (targetNs === currentNamespace && destKey === singleItem.fullKey) {
      setError('Destination path is identical to the current location.');
      return;
    }

    if (isFolder && targetNs === currentNamespace && isSelfOrDescendant(singleItem.fullKey, destKey)) {
      setError(`Cannot ${actionWord} a directory into itself or one of its child directories.`);
      return;
    }

    setIsSubmitting(true);
    try {
      if (onMove) {
        await onMove(targetNs, destKey);
      }
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `Failed to ${actionWord} item`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs font-sans select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg bg-[#0e0e0e] border border-[#262626] p-5 shadow-2xl space-y-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isCopy ? (
              <Copy className="w-4 h-4 text-blue-400" />
            ) : (
              <Folder className="w-4 h-4 text-[#eab308]" />
            )}
            <h3 className="text-sm font-medium text-white">
              {isMultiple
                ? `${ActionWord} ${activeItems.length} Items`
                : `${ActionWord} ${isFolder ? 'Folder' : 'Object'}`}
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
          <div className="p-2.5 rounded-md bg-[#ef4444]/10 border border-[#ef4444]/30 text-xs text-[#ef4444] flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-[#8c8c8c] font-medium mb-1.5">
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
              <label className="text-xs text-[#8c8c8c] font-medium">
                Destination Folder Path
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setTargetFolder('')}
                  className="text-xs text-[#8c8c8c] hover:text-white px-2 py-0.5 rounded bg-[#1c1c1c] border border-[#2a2a2a] cursor-pointer"
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
              className="w-full h-9 px-3 rounded-md bg-[#141414] border border-[#262626] focus:border-[#383838] text-white text-sm outline-none"
            />

            {availableFolders.length > 0 && (
              <div className="mt-2.5 space-y-1.5">
                <span className="text-xs text-[#777777] block">Quick folder picker:</span>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {availableFolders.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setTargetFolder(f)}
                      className="text-xs text-[#cccccc] hover:text-white px-2.5 py-1 rounded-md bg-[#181818] border border-[#262626] hover:border-[#383838] cursor-pointer"
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Destination Preview */}
          <div className="p-3 rounded-md bg-[#080808] border border-[#222222] text-xs space-y-1">
            <span className="text-[#8c8c8c] block text-xs">Resulting Location:</span>
            <div className="text-white flex items-center gap-1.5 truncate">
              <span className="text-[#cccccc]">{targetNs}</span>
              <span className="text-[#555555]">/</span>
              <span className="truncate">
                {isMultiple
                  ? `${cleanDir || '(root)'} (${activeItems.length} items)`
                  : destKey}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              isLoading={isSubmitting}
            >
              {isCopy ? (
                <Copy className="w-3.5 h-3.5 mr-1" />
              ) : (
                <ArrowRight className="w-3.5 h-3.5 mr-1" />
              )}
              {isMultiple ? `${ActionWord} ${activeItems.length} Items` : `${ActionWord} Here`}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
