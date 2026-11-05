import React, { useState, useEffect } from 'react';
import { SavedFilterRecord } from '../types';
import { StorageService } from '../lib/storageAdapter';
import { useApp } from '../context/AppContext';
import { Badge } from '../components/common/Badge';
import { Modal } from '../components/common/Modal';
import { Filter, Plus, Trash2, ArrowRight } from 'lucide-react';

export const SavedFiltersView: React.FC = () => {
  const { setActiveTab, showToast, refreshData } = useApp();

  const [filters, setFilters] = useState<SavedFilterRecord[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [filterName, setFilterName] = useState<string>('');
  const [targetEntity, setTargetEntity] = useState<any>('accounts');
  const [statusCondition, setStatusCondition] = useState<string>('active');

  useEffect(() => {
    StorageService.getSavedFilters().then(res => setFilters(res));
  }, []);

  const handleApplyFilter = (filter: SavedFilterRecord) => {
    if (filter.entity_type === 'accounts') {
      setActiveTab('accounts');
    } else if (filter.entity_type === 'orders') {
      setActiveTab('orders');
    } else if (filter.entity_type === 'returns') {
      setActiveTab('returns');
    }
    showToast(`Applied saved filter: ${filter.name}`, 'info');
  };

  const handleDelete = async (id: string, name: string) => {
    await StorageService.deleteFilter(id);
    setFilters(filters.filter(f => f.id !== id));
    showToast(`Deleted saved view: ${name}`, 'info');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!filterName.trim()) return;
    const created = await StorageService.saveFilter({
      name: filterName.trim(),
      entity_type: targetEntity,
      filter_conditions: { record_status: statusCondition },
      is_shared: true,
    });
    setFilters([created, ...filters]);
    showToast(`Created saved filter: ${created.name}`, 'success');
    setIsCreateOpen(false);
    setFilterName('');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Filter className="w-5 h-5 text-pink-400" />
            <h2 className="text-xl font-bold text-slate-100">Saved Filters & Views</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Persist complex operational queries and custom criteria. Note: Saved filters never add extra visible columns to the main account table.
          </p>
        </div>

        <button
          onClick={() => setIsCreateOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-pink-700 hover:bg-pink-600 text-white rounded-xl text-xs font-semibold shadow-md transition-all self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>New Saved View</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filters.map(filter => (
          <div
            key={filter.id}
            className="p-5 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col justify-between hover:border-slate-700 transition-all shadow-lg"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <Badge variant="primary" size="sm">
                  {filter.entity_type}
                </Badge>
                {filter.is_shared && (
                  <span className="text-[10px] text-slate-500 font-medium">Shared</span>
                )}
              </div>
              <h3 className="text-base font-semibold text-slate-100">{filter.name}</h3>
              <p className="text-xs text-slate-400 font-mono mt-1 bg-slate-950 p-2 rounded border border-slate-800">
                {JSON.stringify(filter.filter_conditions)}
              </p>
            </div>

            <div className="flex items-center justify-between mt-5 pt-3 border-t border-slate-800">
              <button
                onClick={() => handleDelete(filter.id, filter.name)}
                className="p-1.5 text-slate-500 hover:text-rose-400 rounded transition-colors cursor-pointer"
                title="Delete filter"
              >
                <Trash2 className="w-4 h-4" />
              </button>

              <button
                onClick={() => handleApplyFilter(filter)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-pink-950/80 hover:bg-pink-900/80 text-pink-300 border border-pink-700/60 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                <span>Run View</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Create Filter Modal */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Create Saved View"
        subtitle="Save criteria without modifying table schema"
        maxWidth="md"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
              View Name
            </label>
            <input
              type="text"
              value={filterName}
              onChange={e => setFilterName(e.target.value)}
              placeholder="e.g. Incomplete Identity Profiles"
              required
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-slate-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                Target Entity
              </label>
              <select
                value={targetEntity}
                onChange={e => setTargetEntity(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-slate-100"
              >
                <option value="accounts">Accounts</option>
                <option value="orders">Orders</option>
                <option value="returns">Returns</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                Record Status
              </label>
              <select
                value={statusCondition}
                onChange={e => setStatusCondition(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-slate-100"
              >
                <option value="active">Active</option>
                <option value="review_required">Review Required</option>
                <option value="conflict">Conflict</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setIsCreateOpen(false)}
              className="px-4 py-2 text-xs text-slate-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-pink-700 hover:bg-pink-600 text-white rounded-lg text-xs font-semibold"
            >
              Save View
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
