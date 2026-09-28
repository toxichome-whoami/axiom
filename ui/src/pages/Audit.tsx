/*
 * Audit log viewer built with Shadcn UI primitives.
 * Owned by: ui/pages
 * Key deps: ../components/ui, ../api
 * Invariants: Paginated immutable record display, inspection modal dialog, safe array guard.
 */

import React, { useState, useEffect } from 'react';
import { api, type AuditRecord } from '../api';
import {
  Button,
  Badge,
  Input,
  Dialog,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  toast,
} from '../components/ui';
import { Search, Eye, ChevronLeft, ChevronRight } from 'lucide-react';

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
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search audit records..."
            className="pl-8"
          />
        </div>
        <span className="text-xs text-[#666666] ">
          {filtered.length} total events
        </span>
      </div>

      {/* Audit Table */}
      <div className="rounded-lg border border-[#222222] bg-[#0c0c0c] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead className="text-right">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-[#666666]">
                  Loading audit events...
                </TableCell>
              </TableRow>
            ) : displayed.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-[#666666]">
                  {search ? `No events match "${search}".` : 'No audit records logged yet.'}
                </TableCell>
              </TableRow>
            ) : (
              displayed.map((rec) => (
                <TableRow key={rec.id}>
                  <TableCell className=" text-[#8c8c8c]">
                    {new Date(rec.timestamp * 1000).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-medium text-white">{rec.actor}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      <span
                        aria-hidden="true"
                        className="size-1.5 rounded-full bg-amber-500"
                      />
                      {rec.action}
                    </Badge>
                  </TableCell>
                  <TableCell className=" text-[#8c8c8c]">{rec.target}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedRecord(rec)}
                      className="h-7 text-xs"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Inspect</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-[#222222] flex items-center justify-between bg-[#0e0e0e]">
            <span className="text-xs text-[#666666]">
              Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Record Inspection Dialog */}
      <Dialog
        isOpen={!!selectedRecord}
        onClose={() => setSelectedRecord(null)}
        title="Audit Event Details"
        description={`Record ID #${selectedRecord?.id}`}
      >
        {selectedRecord && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="block text-[#666666]  text-[10px] ">Actor</span>
                <span className="font-medium text-white">{selectedRecord.actor}</span>
              </div>
              <div>
                <span className="block text-[#666666]  text-[10px] ">Timestamp</span>
                <span className=" text-[#cccccc]">
                  {new Date(selectedRecord.timestamp * 1000).toISOString()}
                </span>
              </div>
              <div>
                <span className="block text-[#666666]  text-[10px] ">Action</span>
                <Badge variant="outline">
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-amber-500"
                  />
                  {selectedRecord.action}
                </Badge>
              </div>
              <div>
                <span className="block text-[#666666]  text-[10px] ">Target</span>
                <span className=" text-white">{selectedRecord.target}</span>
              </div>
            </div>

            <div>
              <span className="block text-[#666666]  text-[10px]  mb-1">
                Metadata / Event Details
              </span>
              <pre className="p-3 rounded bg-[#080808] border border-[#222222]  text-xs text-[#a1a1a1] overflow-x-auto whitespace-pre-wrap">
                {selectedRecord.details || 'No additional metadata attached.'}
              </pre>
            </div>

            <div className="flex justify-end pt-3 border-t border-[#1e1e1e]">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedRecord(null)}
              >
                Close
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
};
