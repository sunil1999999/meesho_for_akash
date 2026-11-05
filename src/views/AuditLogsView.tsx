import React, { useState, useEffect } from 'react';
import { AuditLogRecord } from '../types';
import { StorageService } from '../lib/storageAdapter';
import { useApp } from '../context/AppContext';
import { FileText, Shield, Clock, Search } from 'lucide-react';
import { Badge } from '../components/common/Badge';

export const AuditLogsView: React.FC = () => {
  const { dataVersion } = useApp();
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [search, setSearch] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    StorageService.getAuditLogs(100).then(res => {
      if (isMounted) {
        setLogs(res);
        setLoading(false);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [dataVersion]);

  const filteredLogs = logs.filter(l => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      l.action.toLowerCase().includes(q) ||
      l.entity_type.toLowerCase().includes(q) ||
      JSON.stringify(l.change_summary || {}).toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-pink-400" />
            <h2 className="text-xl font-bold text-slate-100">Audit & Compliance Trail</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Chronological log of administrative actions, account updates, archive events, and batch operations.
          </p>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search audit trail..."
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-950 border border-slate-700 rounded-lg text-slate-100 font-mono"
          />
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/80 text-slate-400 font-semibold uppercase tracking-wider">
                <th className="py-3.5 px-4">Timestamp</th>
                <th className="py-3.5 px-4">Action</th>
                <th className="py-3.5 px-4">Entity Type</th>
                <th className="py-3.5 px-4">Change Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {loading ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-slate-400">
                    Loading audit trail...
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-slate-400">
                    No audit records match query.
                  </td>
                </tr>
              ) : (
                filteredLogs.map(log => (
                  <tr key={log.id} className="hover:bg-slate-800/40">
                    <td className="py-3.5 px-4 font-mono text-slate-400 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-semibold text-pink-300">
                      {log.action}
                    </td>
                    <td className="py-3.5 px-4 uppercase font-mono text-slate-400">
                      {log.entity_type}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[11px] text-slate-300 max-w-md truncate">
                      {JSON.stringify(log.change_summary || {})}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
