import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Footer } from './Footer';
import { GlobalSearchModal } from '../shared/GlobalSearchModal';
import { ToastContainer } from '../ui/Toast';
import { ConfirmDialogContainer } from '../ui/ConfirmDialog';

class LayoutErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[Layout ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full max-w-4xl mx-auto p-6 rounded-lg border border-[#26282a] bg-[#161718] text-white space-y-3 my-8">
          <div className="text-base font-semibold text-rose-500">Component Error</div>
          <p className="text-xs text-[#a1a1a1]">
            An unexpected error occurred while rendering this dashboard view.
          </p>
          <pre className="text-xs font-mono text-[#8c8c8c] bg-[#0e0e0e] p-3 rounded overflow-x-auto border border-[#26282a]">
            {this.state.error?.message || 'Unknown view render error'}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="h-8 px-3 rounded text-xs font-medium bg-[#3b82f6] hover:bg-[#2563eb] text-white transition-colors"
          >
            Reload View
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export const Layout: React.FC = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-[#000000] text-gray-100 font-sans selection:bg-[#f38020] selection:text-black">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        <TopBar onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />

        <main className="flex-1 px-4 sm:px-6 py-6 w-full max-w-[1440px] mx-auto flex flex-col">
          <LayoutErrorBoundary>
            <Outlet />
          </LayoutErrorBoundary>
        </main>

        <Footer />
      </div>

      <GlobalSearchModal />
      <ToastContainer />
      <ConfirmDialogContainer />
    </div>
  );
};
