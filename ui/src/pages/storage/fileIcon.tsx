/*
 * File format visual categorization icons matching Drive styling.
 * Owned by: ui/pages/storage
 * Key deps: lucide-react
 * Invariants: Returns a consistent SVG icon node based on file extension.
 * Last structural change: Extracted from monolithic Storage.tsx.
 */

import React from 'react';
import {
  File,
  FileText,
  Image as ImageIcon,
  FileCode,
  Archive,
  Film,
  Music,
} from 'lucide-react';

/**
 * Returns categorized icon based on file extension without decorative neon fills.
 */
export function getFileIcon(key: string, className = 'w-4 h-4 shrink-0') {
  const ext = key.split('.').pop()?.toLowerCase() || '';

  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext)) {
    return <ImageIcon className={`${className} text-[#38bdf8]`} />;
  }
  if (['pdf', 'txt', 'md', 'doc', 'docx', 'rtf'].includes(ext)) {
    return <FileText className={`${className} text-[#fb7185]`} />;
  }
  if (['json', 'js', 'ts', 'tsx', 'jsx', 'rs', 'py', 'go', 'html', 'css', 'sql', 'toml', 'yaml', 'yml'].includes(ext)) {
    return <FileCode className={`${className} text-[#fbbf24]`} />;
  }
  if (['zip', 'tar', 'gz', 'tgz', '7z', 'rar', 'bz2'].includes(ext)) {
    return <Archive className={`${className} text-[#c084fc]`} />;
  }
  if (['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext)) {
    return <Film className={`${className} text-[#a78bfa]`} />;
  }
  if (['mp3', 'wav', 'ogg', 'flac', 'aac'].includes(ext)) {
    return <Music className={`${className} text-[#ec4899]`} />;
  }
  return <File className={`${className} text-[#8c8c8c]`} />;
}

/**
 * Returns formatted uppercase file extension tag for badges.
 */
export function getFileExtension(key: string): string {
  const parts = key.split('.');
  if (parts.length > 1) {
    const ext = parts.pop()?.toUpperCase() || '';
    return ext.length <= 5 ? ext : 'FILE';
  }
  return 'FILE';
}
