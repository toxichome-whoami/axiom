import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="mt-auto border-t border-[#222222] bg-[#000000] px-6 py-4 text-xs text-[#666666] flex flex-col sm:flex-row items-center justify-between gap-2 select-none">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald-500" />
        <span className="text-[#8c8c8c] font-medium">All Systems Operational</span>
      </div>
      <div className="flex items-center gap-4 text-[11px] font-mono">
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
