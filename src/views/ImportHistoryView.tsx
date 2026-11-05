import React from 'react';
import { History, FileText, CheckCircle2 } from 'lucide-react';
import { Badge } from '../components/common/Badge';

export const ImportHistoryView: React.FC = () => {
  const dummyHistory = [
    {
      id: 'job_01',
      file: 'accounts_batch_2025_01.json',
      type: 'JSON Array',
      total: 1420,
      inserted: 1390,
      duplicates: 30,
      date: '2025-01-15T10:30:00Z',
      status: 'completed',
    },
    {
      id: 'job_02',
      file: 'import_manual_txt.txt',
      type: 'Consecutive Pretty TXT',
      total: 85,
      inserted: 80,
      duplicates: 5,
      date: '2025-01-20T14:15:00Z',
      status: 'completed',
    },
    {
      id: 'job_03',
      file: 'legacy_import.jsonl',
      type: 'JSON Lines',
      total: 310,
      inserted: 295,
      duplicates: 15,
      date: '2025-02-01T09:00:00Z',
      status: 'completed',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <History className="w-5 h-5 text-pink-400" />
        <h2 className="text-xl font-bold text-slate-100">Batch Import History</h2>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/80 text-slate-400 font-semibold uppercase tracking-wider">
                <th className="py-3.5 px-4">File Name</th>
                <th className="py-3.5 px-4">Format</th>
                <th className="py-3.5 px-4">Total Records</th>
                <th className="py-3.5 px-4">Inserted</th>
                <th className="py-3.5 px-4">Duplicates Handled</th>
                <th className="py-3.5 px-4">Timestamp</th>
                <th className="py-3.5 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {dummyHistory.map(job => (
                <tr key={job.id} className="hover:bg-slate-800/40">
                  <td className="py-3.5 px-4 font-mono font-medium text-slate-200 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-pink-400" />
                    <span>{job.file}</span>
                  </td>
                  <td className="py-3.5 px-4 text-slate-400">{job.type}</td>
                  <td className="py-3.5 px-4 font-mono font-bold text-slate-100">{job.total}</td>
                  <td className="py-3.5 px-4 font-mono text-emerald-400 font-semibold">{job.inserted}</td>
                  <td className="py-3.5 px-4 font-mono text-amber-400">{job.duplicates}</td>
                  <td className="py-3.5 px-4 font-mono text-slate-400">
                    {new Date(job.date).toLocaleString()}
                  </td>
                  <td className="py-3.5 px-4">
                    <Badge variant="success" size="sm">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>{job.status}</span>
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
