/*
 * Footer component matching the Shadcn dashboard inspiration.
 * Owned by: ui/components/layout
 * Key deps: React
 * Invariants: Status indicator dot, GitHub link, version banner.
 */

import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="mt-auto border-t border-[#1c1c1f] bg-[#0c0c0e] px-6 py-4 text-xs text-[#71717a] flex flex-col sm:flex-row items-center justify-between gap-2 select-none">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-[#a1a1aa] font-medium text-xs">All Systems Operational</span>
      </div>
      <div className="flex items-center gap-4 text-[11px]  text-[#71717a]">
        <a
          href="https://github.com/toxichome-whoami/axiom"
          target="_blank"
          rel="noreferrer"
          className="hover:text-white transition-colors"
        >
          GitHub Repository
        </a>
        <span>•</span>
        <span>Axiom Core v4.0.0</span>
      </div>
    </footer>
  );
};
