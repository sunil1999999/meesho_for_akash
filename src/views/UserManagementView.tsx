import React from 'react';
import { useAuth } from '../context/AuthContext';
import { UserCheck, Shield, CheckCircle2, XCircle } from 'lucide-react';
import { Badge } from '../components/common/Badge';

export const UserManagementView: React.FC = () => {
  const { currentUser } = useAuth();

  const permissionsMatrix = [
    { permission: 'View Normalized Mobile Numbers', admin: true, ops: true, viewer: true },
    { permission: 'View Unmasked Sensitive Credentials (Tokens, HW IDs)', admin: true, ops: true, viewer: false },
    { permission: 'Import Accounts (JSON / TXT / JSONL)', admin: true, ops: true, viewer: false },
    { permission: 'Export Account Data & Raw JSON', admin: true, ops: true, viewer: false },
    { permission: 'Bulk Edit Metadata & Assign Tags', admin: true, ops: true, viewer: false },
    { permission: 'Archive & Restore Accounts', admin: true, ops: true, viewer: false },
    { permission: 'Permanently Purge Records (Recycle Bin)', admin: true, ops: false, viewer: false },
    { permission: 'Run CSV Reconciliation', admin: true, ops: true, viewer: false },
    { permission: 'Configure Supabase Database & Keys', admin: true, ops: false, viewer: false },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-pink-400" />
            <h2 className="text-xl font-bold text-slate-100">User Management & Access Control</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Role-Based Access Control (RBAC) governing sensitive credential visibility, archiving, and database administration.
          </p>
        </div>
      </div>

      {/* Current Session Card */}
      <div className="bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-pink-600 to-rose-700 flex items-center justify-center text-white shadow-lg shadow-pink-900/50">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-100">{currentUser.full_name}</h3>
              <Badge variant="primary" size="sm">
                {currentUser.role.toUpperCase()}
              </Badge>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5">{currentUser.email}</p>
          </div>
        </div>

        {/* Single User Access Status */}
        <div className="flex items-center gap-3 bg-slate-950 px-4 py-2.5 rounded-xl border border-slate-800 text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold text-slate-200">Single-User Access Active</span>
          </div>
          <span className="text-slate-500">|</span>
          <span className="text-slate-400 text-[11px]">Public registration & guest mode disabled</span>
        </div>
      </div>

      {/* Permissions Matrix */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800 bg-slate-950/70">
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            RBAC Capabilities Matrix
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/40 text-slate-400 font-semibold uppercase tracking-wider">
                <th className="py-3 px-4">Feature / Action</th>
                <th className="py-3 px-4 text-center">Administrator</th>
                <th className="py-3 px-4 text-center">Operations Manager</th>
                <th className="py-3 px-4 text-center">Viewer (Auditor)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {permissionsMatrix.map((item, idx) => (
                <tr key={idx} className="hover:bg-slate-800/40">
                  <td className="py-3 px-4 font-medium text-slate-200">{item.permission}</td>
                  <td className="py-3 px-4 text-center">
                    {item.admin ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" />
                    ) : (
                      <XCircle className="w-4 h-4 text-slate-600 mx-auto" />
                    )}
                  </td>
                  <td className="py-3 px-4 text-center">
                    {item.ops ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" />
                    ) : (
                      <XCircle className="w-4 h-4 text-slate-600 mx-auto" />
                    )}
                  </td>
                  <td className="py-3 px-4 text-center">
                    {item.viewer ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" />
                    ) : (
                      <XCircle className="w-4 h-4 text-slate-600 mx-auto" />
                    )}
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
