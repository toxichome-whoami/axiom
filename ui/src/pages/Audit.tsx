import React, { useState, useEffect } from 'react';
import { api, type AuditRecord } from '../api';
import { toast } from '../components/ui/Toast';
import { FileText, Search, Eye, ChevronLeft, ChevronRight, X } from 'lucide-react';

export const Audit: React.FC = () => {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [selectedRecord, setSelectedRecord] = useState<AuditRecord | null>(null);

  const loadAudit = async () => {
    try {
      setLoading(true);
      const res = await api.getAuditLog(150, 0);
      setRecords(res);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAudit();
  }, []);

  const safeRecords = Array.isArray(records) ? records : [];
  const filtered = safeRecords.filter(
    (r) =>
      (r.actor && r.actor.toLowerCase().includes(search.toLowerCase())) ||
      (r.action && r.action.toLowerCase().includes(search.toLowerCase())) ||
      (r.target && r.target.toLowerCase().includes(search.toLowerCase())) ||
      (r.details && r.details.toLowerCase().includes(search.toLowerCase()))
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const displayed = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#222222] pb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Security Audit Log</h1>
          <p className="text-xs text-[#8c8c8c] mt-1">
            Immutable chronicle of administrative actions, key rotations, and access policy mutations.
          </p>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="w-3.5 h-3.5 text-[#666666] absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search audit records..."
            className="w-full h-8 pl-8 pr-3 rounded bg-[#0e0e0e] border border-[#222222] text-xs text-white placeholder-[#666666] focus:border-[#f38020] focus:outline-none"
          />
        </div>
        <span className="text-xs text-[#666666] font-mono">
          {filtered.length} total events
        </span>
      </div>

      {/* Audit Table */}
      <div className="rounded-lg border border-[#222222] bg-[#0c0c0c] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#141414] text-[#8c8c8c] border-b border-[#222222]">
              <tr>
                <th className="px-4 py-3 font-medium">Timestamp</th>
                <th className="px-4 py-3 font-medium">Actor</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Target</th>
                <th className="px-4 py-3 font-medium text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e1e1e]">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[#666666]">
                    Loading audit events...
                  </td>
                </tr>
              ) : displayed.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-[#666666]">
                    {search ? `No events match "${search}".` : 'No audit records logged yet.'}
                  </td>
                </tr>
              ) : (
                displayed.map((evt) => (
                  <tr key={evt.id} className="hover:bg-[#141414] transition-colors">
                    <td className="px-4 py-3 font-mono text-[#8c8c8c]">
                      {new Date(evt.timestamp * 1000).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-medium text-white">{evt.actor}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-[#141414] border border-[#262626] text-[#f38020]">
                        {evt.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[#8c8c8c]">{evt.target}</td>
                    <td className="px-4 py-3 text-right">
                      {evt.details ? (
                        <button
                          onClick={() => setSelectedRecord(evt)}
                          className="h-7 px-2 rounded bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] text-[11px] font-medium text-[#cccccc] hover:text-white transition-colors inline-flex items-center gap-1"
                        >
                          <Eye className="w-3 h-3 text-[#3b82f6]" />
                          <span>Inspect</span>
                        </button>
                      ) : (
                        <span className="text-[#555555]">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        <div className="px-4 py-3 border-t border-[#222222] bg-[#0e0e0e] flex items-center justify-between">
          <span className="text-xs text-[#8c8c8c]">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="h-7 w-7 rounded bg-[#141414] hover:bg-[#1c1c1c] border border-[#262626] disabled:opacity-40 text-white flex items-center justify-center transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="h-7 w-7 rounded bg-[#141414] hover:bg-[#1c1c1c] border border-[#262626] disabled:opacity-40 text-white flex items-center justify-center transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Inspect Detail Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-[560px] rounded-lg border border-[#262626] bg-[#0c0c0c] p-6 shadow-2xl text-left">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#f38020]" />
                <h3 className="text-sm font-semibold text-white">Event Detail Inspector</h3>
              </div>
              <button
                onClick={() => setSelectedRecord(null)}
                className="text-[#666666] hover:text-white p-1 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[#666666] block">Action:</span>
                  <span className="font-mono text-white">{selectedRecord.action}</span>
                </div>
                <div>
                  <span className="text-[#666666] block">Actor:</span>
                  <span className="text-white">{selectedRecord.actor}</span>
                </div>
              </div>

              <div>
                <span className="text-[#666666] text-xs block mb-1">Payload Details:</span>
                <pre className="p-3 rounded bg-[#101010] border border-[#222222] text-xs font-mono text-[#a1a1a1] overflow-x-auto max-h-60">
                  {selectedRecord.details}
                </pre>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-[#222222] mt-4">
              <button
                onClick={() => setSelectedRecord(null)}
                className="h-8 px-3 rounded text-xs font-medium bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] text-white transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
