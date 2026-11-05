import React, { useState, useEffect } from 'react';
import { DataQualityIssue } from '../types';
import { StorageService } from '../lib/storageAdapter';
import { runDataQualityAudit } from '../lib/dataQualityEngine';
import { triggerFileDownload } from '../lib/exportUtils';
import { Badge } from '../components/common/Badge';
import { useApp } from '../context/AppContext';
import {
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  Info,
  RefreshCw,
  Download,
  Filter,
} from 'lucide-react';

export const DataQualityView: React.FC = () => {
  const { showToast, dataVersion } = useApp();

  const [issues, setIssues] = useState<DataQualityIssue[]>([]);
  const [severityFilter, setSeverityFilter] = useState<'all' | 'critical' | 'warning' | 'info'>('all');
  const [entityFilter, setEntityFilter] = useState<'all' | 'account' | 'order'>('all');
  const [isRunning, setIsRunning] = useState<boolean>(false);

  const performAudit = async () => {
    setIsRunning(true);
    try {
      const accountsRes = await StorageService.getAccounts({ includeArchived: true, pageSize: 5000 });
      const orders = await StorageService.getOrders();
      const detected = runDataQualityAudit(accountsRes.accounts, orders);
      setIssues(detected);
      showToast(`Data quality audit complete: ${detected.length} issue(s) detected`, 'info');
    } finally {
      setIsRunning(false);
    }
  };

  useEffect(() => {
    performAudit();
  }, [dataVersion]);

  const handleDownloadReport = () => {
    const headers = ['Issue ID', 'Entity Type', 'Entity ID', 'Mobile', 'Severity', 'Rule Code', 'Description', 'Suggested Correction'];
    const rows = issues.map(i => [
      `"${i.id}"`,
      `"${i.entity_type}"`,
      `"${i.entity_id}"`,
      `"${i.phone_display || ''}"`,
      `"${i.severity}"`,
      `"${i.rule_code}"`,
      `"${i.description.replace(/"/g, '""')}"`,
      `"${(i.suggested_correction || '').replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    triggerFileDownload(csv, `data_quality_report_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
    showToast('Downloaded Data Quality Report CSV', 'success');
  };

  const filteredIssues = issues.filter(i => {
    if (severityFilter !== 'all' && i.severity !== severityFilter) return false;
    if (entityFilter !== 'all' && i.entity_type !== entityFilter) return false;
    return true;
  });

  const criticalCount = issues.filter(i => i.severity === 'critical').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const infoCount = issues.filter(i => i.severity === 'info').length;

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-pink-400" />
            <h2 className="text-xl font-bold text-slate-100">Data Quality & Integrity Engine</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Automated checks for phone normalization, duplicate identities, orphaned orders, and missing metadata.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadReport}
            disabled={issues.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-xl text-xs font-medium border border-slate-700 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>Export Report CSV</span>
          </button>

          <button
            onClick={performAudit}
            disabled={isRunning}
            className="flex items-center gap-1.5 px-4 py-2 bg-pink-700 hover:bg-pink-600 text-white rounded-xl text-xs font-semibold shadow-md transition-all cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
            <span>Run Audit Now</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <span className="text-[11px] text-slate-400">Total Issues Detected</span>
          <p className="text-2xl font-bold font-mono text-slate-100 mt-0.5">{issues.length}</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <span className="text-[11px] text-rose-400 font-medium">Critical Issues</span>
          <p className="text-2xl font-bold font-mono text-rose-300 mt-0.5">{criticalCount}</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <span className="text-[11px] text-amber-400 font-medium">Warnings</span>
          <p className="text-2xl font-bold font-mono text-amber-300 mt-0.5">{warningCount}</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <span className="text-[11px] text-cyan-400 font-medium">Informational</span>
          <p className="text-2xl font-bold font-mono text-cyan-300 mt-0.5">{infoCount}</p>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 font-medium">Severity:</span>
          {['all', 'critical', 'warning', 'info'].map(sev => (
            <button
              key={sev}
              onClick={() => setSeverityFilter(sev as any)}
              className={`px-2.5 py-1 rounded-lg capitalize font-medium transition-colors cursor-pointer ${
                severityFilter === sev
                  ? 'bg-pink-700 text-white'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {sev}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-slate-400 font-medium">Entity:</span>
          {['all', 'account', 'order'].map(ent => (
            <button
              key={ent}
              onClick={() => setEntityFilter(ent as any)}
              className={`px-2.5 py-1 rounded-lg capitalize font-medium transition-colors cursor-pointer ${
                entityFilter === ent
                  ? 'bg-pink-700 text-white'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {ent}
            </button>
          ))}
        </div>
      </div>

      {/* Issues Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/80 text-slate-400 font-semibold uppercase tracking-wider">
                <th className="py-3.5 px-4">Severity</th>
                <th className="py-3.5 px-4">Entity</th>
                <th className="py-3.5 px-4">Identifier / Phone</th>
                <th className="py-3.5 px-4">Issue Description</th>
                <th className="py-3.5 px-4">Suggested Correction</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredIssues.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-400">
                    <ShieldCheck className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-slate-200">
                      No issues match current filter
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">Database integrity conforms to quality rules.</p>
                  </td>
                </tr>
              ) : (
                filteredIssues.map(issue => (
                  <tr key={issue.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3.5 px-4">
                      <Badge
                        variant={
                          issue.severity === 'critical'
                            ? 'danger'
                            : issue.severity === 'warning'
                            ? 'warning'
                            : 'info'
                        }
                        size="sm"
                      >
                        {issue.severity}
                      </Badge>
                    </td>

                    <td className="py-3.5 px-4 font-mono uppercase text-slate-400 font-medium">
                      {issue.entity_type}
                    </td>

                    <td className="py-3.5 px-4 font-mono font-semibold text-pink-300">
                      {issue.phone_display || issue.entity_id}
                    </td>

                    <td className="py-3.5 px-4 max-w-sm text-slate-200">
                      <p className="font-medium">{issue.description}</p>
                      <span className="font-mono text-[10px] text-slate-500">
                        Rule: {issue.rule_code}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-emerald-300 font-mono text-[11px]">
                      {issue.suggested_correction || 'Review manually'}
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
