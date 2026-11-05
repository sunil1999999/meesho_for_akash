/**
 * Storage Adapter for Meesho Management Dashboard
 * 
 * Supports both live Supabase PostgreSQL backend and robust client persistence
 * with transaction logging, undo history, and audit events.
 */

import { supabase, isSupabaseConfigured } from './supabase';
import {
  AccountRecord,
  OrderRecord,
  OrderEvent,
  AuditLogRecord,
  SavedFilterRecord,
  ImportJobRecord,
  DuplicateResolutionStrategy,
  WorkerHeartbeatRecord,
  DeliveryAddress,
} from '../types';
import { normalizePhoneNumber, matchesMobileNumber } from './phoneUtils';
import { extractTrackingId } from './trackingExtractor';
import { saveDeliveryAddress, clearSavedAddresses } from './addressStorage';

const ACCOUNTS_STORAGE_KEY = 'meesho_accounts_data_v1';
const ORDERS_STORAGE_KEY = 'meesho_orders_data_v1';
const AUDIT_STORAGE_KEY = 'meesho_audit_logs_v1';
const FILTERS_STORAGE_KEY = 'meesho_saved_filters_v1';
const IMPORT_JOBS_KEY = 'meesho_import_jobs_v1';

// Seed initial realistic data if empty
function initializeSeedData(): {
  accounts: AccountRecord[];
  orders: OrderRecord[];
  savedFilters: SavedFilterRecord[];
} {
  const sampleAccounts: AccountRecord[] = [
    {
      id: 'acc_01_9033807401',
      phone_normalized: '+919033807401',
      phone_display: '+91 90338 07401',
      account_json: {
        mobile: '9033807401',
        phone: '9033807401',
        user_id: 'usr_meesho_892104',
        xo: 'x-auth-sample-token-a9f82d1c',
        ox: 'ox-refresh-token-38b472e',
        instance_id: 'inst_android_samsung_a52_0912',
        gaid: '38400000-8cf0-11bd-b23e-10b96e40000d',
        identity: {
          app_version: '14.8.2',
          device_model: 'SM-A525F',
          os_version: 'Android 13',
          locale: 'en_IN',
        },
        profile: {
          name: 'Rajesh Sharma',
          email: 'rajesh.sharma@example.com',
          created_date: '2025-01-15T10:30:00Z',
        },
      },
      record_status: 'active',
      tags: ['verified', 'high_volume'],
      notes: 'Primary test account',
      source_file: 'accounts_batch_2025_01.json',
      is_archived: false,
      created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
      updated_at: new Date(Date.now() - 15 * 86400000).toISOString(),
    },
    {
      id: 'acc_02_9820192831',
      phone_normalized: '+919820192831',
      phone_display: '+91 98201 92831',
      account_json: {
        mobile: '9820192831',
        user_id: 'usr_meesho_471920',
        xo: 'x-auth-sample-token-55a198c',
        ox: 'ox-refresh-token-82f912a',
        instance_id: 'inst_android_redmi_note10_1189',
        gaid: '47200000-8cf0-11bd-b23e-20c86e40000e',
        identity: {
          app_version: '14.9.0',
          device_model: 'Redmi Note 10 Pro',
          os_version: 'Android 12',
        },
      },
      record_status: 'active',
      tags: ['tier_1'],
      source_file: 'accounts_batch_2025_01.json',
      is_archived: false,
      created_at: new Date(Date.now() - 25 * 86400000).toISOString(),
      updated_at: new Date(Date.now() - 10 * 86400000).toISOString(),
    },
    {
      id: 'acc_03_9123456780',
      phone_normalized: '+919123456780',
      phone_display: '+91 91234 56780',
      account_json: {
        mobile: '9123456780',
        user_id: 'usr_meesho_193821',
        xo: 'x-auth-sample-token-99c831e',
        ox: 'ox-refresh-token-44d821a',
        instance_id: 'inst_android_oneplus_nord_9912',
        gaid: '58100000-8cf0-11bd-b23e-30d76e40000f',
      },
      record_status: 'review_required',
      tags: ['review_needed'],
      source_file: 'import_manual_txt.txt',
      is_archived: false,
      created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
      updated_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    },
    {
      id: 'acc_04_9876543210',
      phone_normalized: '+919876543210',
      phone_display: '+91 98765 43210',
      account_json: {
        mobile: '9876543210',
        user_id: 'usr_meesho_771239',
        xo: 'x-auth-sample-token-33b118a',
        instance_id: 'inst_android_vivo_v20',
      },
      record_status: 'archived',
      tags: ['inactive'],
      source_file: 'legacy_import.jsonl',
      is_archived: true,
      archived_at: new Date(Date.now() - 2 * 86400000).toISOString(),
      created_at: new Date(Date.now() - 40 * 86400000).toISOString(),
      updated_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    },
  ];

  // Strict Rule: Never synthesize or fabricate fake placeholder orders
  const sampleOrders: OrderRecord[] = [];

  const sampleFilters: SavedFilterRecord[] = [
    {
      id: 'flt_01',
      name: 'Recently Imported',
      entity_type: 'accounts',
      filter_conditions: { days: 7, is_archived: false },
      sort_field: 'created_at',
      sort_direction: 'DESC',
      is_shared: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'flt_02',
      name: 'Review Required Accounts',
      entity_type: 'accounts',
      filter_conditions: { record_status: 'review_required' },
      sort_field: 'created_at',
      sort_direction: 'DESC',
      is_shared: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'flt_03',
      name: 'Pending Refunds',
      entity_type: 'returns',
      filter_conditions: { refund_status: 'pending' },
      sort_field: 'created_at',
      sort_direction: 'DESC',
      is_shared: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  return { accounts: sampleAccounts, orders: sampleOrders, savedFilters: sampleFilters };
}

// In-Memory & Local Storage State
let accountsCache: AccountRecord[] | null = null;
let ordersCache: OrderRecord[] | null = null;
let auditLogsCache: AuditLogRecord[] | null = null;
let savedFiltersCache: SavedFilterRecord[] | null = null;
let importJobsCache: ImportJobRecord[] | null = null;

// Undo Stack
interface UndoAction {
  id: string;
  description: string;
  timestamp: string;
  revert: () => Promise<void>;
}
const undoStack: UndoAction[] = [];

export const StorageService = {
  // ----------------------------------------------------
  // ACCOUNTS
  // ----------------------------------------------------
  async getAccounts(params?: {
    search?: string;
    includeArchived?: boolean;
    onlyArchived?: boolean;
    status?: string;
    page?: number;
    pageSize?: number;
    sortField?: keyof AccountRecord;
    sortAsc?: boolean;
  }): Promise<{ accounts: AccountRecord[]; total: number }> {
    // If Supabase live is configured, try Supabase first
    if (isSupabaseConfigured) {
      try {
        // Sync any un-persisted local accounts to Supabase
        const unsynced = (accountsCache || []).filter(a => a.id && a.id.startsWith('acc_'));
        if (unsynced.length > 0) {
          try {
            const { data: dbPhones } = await supabase.from('accounts').select('phone_normalized');
            const phoneSet = new Set((dbPhones || []).map(p => p.phone_normalized));
            const toAdd = unsynced.filter(a => !phoneSet.has(a.phone_normalized)).map(a => ({
              phone_normalized: a.phone_normalized,
              phone_display: a.phone_display,
              account_json: a.account_json,
              record_status: a.record_status || 'active',
              tags: a.tags || [],
              source_file: a.source_file || null,
              is_archived: a.is_archived || false,
            }));
            if (toAdd.length > 0) {
              const { data: synced } = await supabase.from('accounts').insert(toAdd).select();
              if (synced) {
                const sMap = new Map<string, AccountRecord>();
                synced.forEach((s: any) => sMap.set(s.phone_normalized, s as AccountRecord));
                accountsCache = (accountsCache || []).map(a => sMap.get(a.phone_normalized) || a);
                this.persistAccounts();
              }
            }
          } catch (syncErr) {
            console.warn('Syncing local accounts to Supabase failed:', syncErr);
          }
        }

        let query = supabase.from('accounts').select('*', { count: 'exact' });

        if (params?.onlyArchived) {
          query = query.eq('is_archived', true);
        } else if (!params?.includeArchived) {
          query = query.eq('is_archived', false);
        }

        if (params?.status) {
          query = query.eq('record_status', params.status);
        }

        if (params?.search) {
          const s = params.search.trim();
          query = query.or(`phone_normalized.ilike.%${s}%,phone_display.ilike.%${s}%`);
        }

        const sortField = params?.sortField || 'created_at';
        query = query.order(sortField, { ascending: params?.sortAsc ?? false });

        const page = params?.page || 1;
        const pageSize = params?.pageSize || 25;
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;
        query = query.range(from, to);

        const { data, count, error } = await query;
        if (!error && data) {
          const dbAccounts = data as AccountRecord[];
          this.ensureInitialized();
          const existingMap = new Map((accountsCache || []).map(a => [a.id, a]));
          dbAccounts.forEach(a => existingMap.set(a.id, a));
          accountsCache = Array.from(existingMap.values());
          this.persistAccounts();
          return { accounts: dbAccounts, total: count ?? dbAccounts.length };
        }
      } catch (err) {
        console.warn('Supabase query failed, falling back to local storage cache:', err);
      }
    }

    // Local Storage / In-Memory Fallback
    this.ensureInitialized();
    let list = [...(accountsCache || [])];

    if (params?.onlyArchived) {
      list = list.filter(a => a.is_archived);
    } else if (!params?.includeArchived) {
      list = list.filter(a => !a.is_archived);
    }

    if (params?.status) {
      list = list.filter(a => a.record_status === params.status);
    }

    if (params?.search) {
      const q = params.search.trim().toLowerCase();
      list = list.filter(a =>
        a.phone_normalized.toLowerCase().includes(q) ||
        a.phone_display.toLowerCase().includes(q)
      );
    }

    // Sort
    const sortField = params?.sortField || 'created_at';
    const sortAsc = params?.sortAsc ?? false;
    list.sort((a, b) => {
      const valA = (a as any)[sortField] || '';
      const valB = (b as any)[sortField] || '';
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });

    const total = list.length;
    const page = params?.page || 1;
    const pageSize = params?.pageSize || 25;
    const paginated = list.slice((page - 1) * pageSize, page * pageSize);

    return { accounts: paginated, total };
  },

  async getAccountById(id: string): Promise<AccountRecord | null> {
    this.ensureInitialized();
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase.from('accounts').select('*').eq('id', id).single();
        if (!error && data) return data as AccountRecord;
      } catch {}
    }
    return (accountsCache || []).find(a => a.id === id) || null;
  },

  async insertAccount(account: Omit<AccountRecord, 'id' | 'created_at' | 'updated_at'>): Promise<AccountRecord> {
    this.ensureInitialized();
    const phoneRes = normalizePhoneNumber(account.phone_normalized);
    const now = new Date().toISOString();

    if (isSupabaseConfigured) {
      try {
        const payload: any = {
          phone_normalized: phoneRes.normalized,
          phone_display: phoneRes.display,
          account_json: account.account_json,
          record_status: account.record_status || 'active',
          tags: account.tags || [],
          notes: account.notes || null,
          source_file: account.source_file || null,
          is_archived: account.is_archived || false,
        };
        const { data, error } = await supabase.from('accounts').insert(payload).select().single();
        if (!error && data) {
          const rec = data as AccountRecord;
          accountsCache = [rec, ...(accountsCache || []).filter(a => a.id !== rec.id)];
          this.persistAccounts();
          await this.addAuditLog('CREATE_ACCOUNT', 'account', rec.id, { phone: rec.phone_display });
          return rec;
        }
      } catch (err) {
        console.warn('Supabase insert failed, using local cache:', err);
      }
    }

    const newRecord: AccountRecord = {
      ...account,
      id: `acc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      phone_normalized: phoneRes.normalized,
      phone_display: phoneRes.display,
      created_at: now,
      updated_at: now,
    };

    accountsCache = [newRecord, ...(accountsCache || [])];
    this.persistAccounts();
    await this.addAuditLog('CREATE_ACCOUNT', 'account', newRecord.id, { phone: newRecord.phone_display });
    return newRecord;
  },

  async saveBatchAccounts(
    records: Array<{
      raw_json: Record<string, any>;
      normalized_phone: string;
      display_phone: string;
      source_file?: string;
      selected_address?: DeliveryAddress | null;
    }>,
    strategy: DuplicateResolutionStrategy = 'skip'
  ): Promise<{ inserted: number; updated: number; skipped: number; records: AccountRecord[] }> {
    this.ensureInitialized();
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    const existingMap = new Map<string, AccountRecord>();
    (accountsCache || []).forEach(a => {
      existingMap.set(a.phone_normalized, a);
    });

    // If Supabase is configured, fetch all existing accounts from Supabase to ensure accurate duplicate detection
    if (isSupabaseConfigured) {
      try {
        const { data: dbAccs, error } = await supabase
          .from('accounts')
          .select('id, phone_normalized, phone_display, account_json, record_status, is_archived');
        if (!error && dbAccs) {
          dbAccs.forEach(a => {
            existingMap.set(a.phone_normalized, a as AccountRecord);
          });
        }
      } catch (err) {
        console.warn('Failed to load accounts from Supabase for batch check:', err);
      }
    }

    const now = new Date().toISOString();
    const toInsertDb: any[] = [];
    let toInsertLocal: AccountRecord[] = [];
    const toUpdateDb: Array<{ id: string; payload: any }> = [];

    for (const item of records) {
      const existing = existingMap.get(item.normalized_phone);

      if (existing) {
        if (strategy === 'skip') {
          skipped++;
          continue;
        } else if (strategy === 'update_approved') {
          const merged = { ...existing.account_json, ...item.raw_json };
          // Only modify address if user explicitly selected one for this record
          if (item.selected_address !== undefined) {
            if (item.selected_address) {
              merged.assigned_address = item.selected_address;
              saveDeliveryAddress(existing.id, item.selected_address);
            } else if (item.selected_address === null) {
              delete merged.assigned_address;
              delete merged.delivery_address;
              clearSavedAddresses(existing.id);
            }
          }
          existing.account_json = merged;
          existing.updated_at = now;
          if (item.source_file) existing.source_file = item.source_file;
          toUpdateDb.push({
            id: existing.id,
            payload: {
              account_json: merged,
              updated_at: now,
              source_file: existing.source_file,
            },
          });
          updated++;
          continue;
        } else {
          existing.record_status = 'review_required';
          existing.updated_at = now;
          toUpdateDb.push({
            id: existing.id,
            payload: {
              record_status: 'review_required',
              updated_at: now,
            },
          });
          updated++;
          continue;
        }
      }

      // Brand new account - apply address ONLY to this specific account if selected
      const rawJson = { ...item.raw_json };
      if (item.selected_address) {
        rawJson.assigned_address = item.selected_address;
      } else {
        delete rawJson.assigned_address;
        delete rawJson.delivery_address;
      }

      const dbPayload = {
        phone_normalized: item.normalized_phone,
        phone_display: item.display_phone,
        account_json: rawJson,
        record_status: 'active' as const,
        tags: [] as string[],
        source_file: item.source_file || null,
        is_archived: false,
      };

      toInsertDb.push(dbPayload);

      const localAcc: AccountRecord = {
        ...dbPayload,
        source_file: item.source_file || undefined,
        id: `acc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        created_at: now,
        updated_at: now,
      };

      if (item.selected_address) {
        saveDeliveryAddress(localAcc.id, item.selected_address);
      }

      toInsertLocal.push(localAcc);
      existingMap.set(localAcc.phone_normalized, localAcc);
      inserted++;
    }

    // Execute updates in Supabase
    if (isSupabaseConfigured && toUpdateDb.length > 0) {
      try {
        for (const u of toUpdateDb) {
          await supabase.from('accounts').update(u.payload).eq('id', u.id);
        }
      } catch (err) {
        console.warn('Supabase batch update error:', err);
      }
    }

    // Execute inserts in Supabase
    if (isSupabaseConfigured && toInsertDb.length > 0) {
      try {
        const batchSize = 50;
        for (let i = 0; i < toInsertDb.length; i += batchSize) {
          const slice = toInsertDb.slice(i, i + batchSize);
          const { data, error } = await supabase.from('accounts').insert(slice).select();
          if (error) {
            console.error('Supabase batch insert error:', error);
          } else if (data) {
            const insertedMap = new Map<string, AccountRecord>();
            data.forEach((d: any) => insertedMap.set(d.phone_normalized, d as AccountRecord));
            for (let j = 0; j < toInsertLocal.length; j++) {
              const realRecord = insertedMap.get(toInsertLocal[j].phone_normalized);
              if (realRecord) {
                const origItem = records.find(r => r.normalized_phone === realRecord.phone_normalized);
                if (origItem?.selected_address) {
                  saveDeliveryAddress(realRecord.id, origItem.selected_address);
                }
                toInsertLocal[j] = realRecord;
              }
            }
          }
        }
      } catch (err) {
        console.error('Supabase batch insert exception:', err);
      }
    }

    if (toInsertLocal.length > 0) {
      accountsCache = [...toInsertLocal, ...(accountsCache || [])];
    }
    this.persistAccounts();

    await this.addAuditLog('IMPORT_BATCH', 'account', undefined, {
      inserted,
      updated,
      skipped,
      strategy,
    });

    return { inserted, updated, skipped, records: toInsertLocal };
  },

  /**
   * Assigns or clears a delivery address for a specific account.
   * Modifies only the designated account without affecting any other account.
   */
  async assignAccountAddress(
    accountId: string,
    address: DeliveryAddress | null
  ): Promise<AccountRecord | null> {
    this.ensureInitialized();
    const acc = (accountsCache || []).find(a => a.id === accountId);
    if (!acc) return null;

    const now = new Date().toISOString();
    const updatedJson = { ...acc.account_json };

    if (address === null) {
      clearSavedAddresses(accountId);
      delete updatedJson.assigned_address;
      delete updatedJson.delivery_address;
    } else {
      saveDeliveryAddress(accountId, address);
      updatedJson.assigned_address = address;
    }

    acc.account_json = updatedJson;
    acc.updated_at = now;

    if (isSupabaseConfigured) {
      try {
        await supabase
          .from('accounts')
          .update({
            account_json: updatedJson,
            updated_at: now,
          })
          .eq('id', accountId);
      } catch (err) {
        console.warn('Failed to update account address in Supabase:', err);
      }
    }

    this.persistAccounts();
    await this.addAuditLog('ASSIGN_ADDRESS', 'account', accountId, {
      action: address ? 'set_address' : 'remove_address',
      addressName: address?.name,
      pin: address?.pin,
    });

    return acc;
  },

  async updateAccount(id: string, updates: Partial<AccountRecord>): Promise<AccountRecord | null> {
    this.ensureInitialized();
    let idx = (accountsCache || []).findIndex(a => a.id === id);
    let previous: AccountRecord;

    if (idx === -1) {
      if (isSupabaseConfigured) {
        try {
          const { data, error } = await supabase.from('accounts').select('*').eq('id', id).single();
          if (error || !data) {
            console.error('Account not found in Supabase:', error);
            return null;
          }
          previous = data as AccountRecord;
          if (!accountsCache) accountsCache = [];
          accountsCache.push(previous);
          idx = accountsCache.length - 1;
        } catch (err) {
          console.error('Failed to fetch account for update:', err);
          return null;
        }
      } else {
        return null;
      }
    } else {
      previous = { ...accountsCache![idx] };
    }

    const isSold = updates.record_status === 'sold';
    const wasSold = previous.record_status === 'sold';
    const updated: AccountRecord = {
      ...previous,
      ...updates,
      monitoring_status: isSold
        ? 'sold_excluded'
        : (updates.monitoring_status || (wasSold ? 'pending' : previous.monitoring_status)),
      next_check_at: isSold
        ? undefined
        : (updates.next_check_at || (wasSold ? new Date().toISOString() : previous.next_check_at)),
      updated_at: new Date().toISOString(),
    };

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isSupabaseConfigured && isUuid) {
      const payload: any = {
        record_status: updated.record_status,
        tags: updated.tags || [],
        notes: updated.notes !== undefined ? updated.notes : null,
        account_json: updated.account_json,
        updated_at: updated.updated_at,
      };
      if (isSold) {
        payload.monitoring_status = 'sold_excluded';
        payload.next_check_at = null;
      } else if (updates.monitoring_status) {
        payload.monitoring_status = updates.monitoring_status;
      } else if (wasSold) {
        payload.monitoring_status = 'pending';
        payload.next_check_at = new Date().toISOString();
      }
      if (updates.is_archived !== undefined) {
        payload.is_archived = updates.is_archived;
        payload.archived_at = updates.archived_at;
      }

      const { error: accErr } = await supabase.from('accounts').update(payload).eq('id', id);
      if (accErr) {
        console.error('Supabase accounts update failed:', accErr);
        throw new Error(accErr.message || 'Supabase account update failed');
      }

      if (isSold) {
        // Permanently exclude all orders for this sold account
        try {
          const { error: ordErr } = await supabase.from('orders').update({
            is_terminal: true,
            monitoring_status: 'terminal_sold',
            next_check_at: null,
            terminal_confirmed_at: updated.updated_at,
          }).eq('account_id', id);
          if (ordErr) {
            console.warn('Orders terminal status update warning:', ordErr);
          }
        } catch (ordErr) {
          console.warn('Orders terminal status update failed:', ordErr);
        }
      }
    }

    if (isSold && ordersCache) {
      ordersCache = ordersCache.map(o => o.account_id === id ? {
        ...o,
        is_terminal: true,
        monitoring_status: 'terminal_sold',
        terminal_confirmed_at: updated.updated_at,
      } : o);
      this.persistOrders();
    }

    // Push to undo stack
    this.pushUndo(`Update account ${updated.phone_display}`, async () => {
      await this.updateAccount(id, previous);
    });

    accountsCache![idx] = updated;
    this.persistAccounts();

    await this.addAuditLog('UPDATE_ACCOUNT', 'account', id, { updates }, previous, updated);
    return updated;
  },

  async archiveAccounts(ids: string[]): Promise<number> {
    this.ensureInitialized();
    const now = new Date().toISOString();
    const affected: AccountRecord[] = [];

    (accountsCache || []).forEach(a => {
      if (ids.includes(a.id) && !a.is_archived) {
        affected.push({ ...a });
        a.is_archived = true;
        a.archived_at = now;
        a.updated_at = now;
      }
    });

    if (isSupabaseConfigured && ids.length > 0) {
      try {
        await supabase.from('accounts').update({
          is_archived: true,
          archived_at: now,
          updated_at: now,
        }).in('id', ids);
      } catch (err) {
        console.warn('Supabase archive failed:', err);
      }
    }

    if (affected.length > 0) {
      this.persistAccounts();
      this.pushUndo(`Archive ${affected.length} account(s)`, async () => {
        await this.restoreAccounts(affected.map(a => a.id));
      });
      await this.addAuditLog('ARCHIVE_ACCOUNTS', 'account', undefined, {
        count: affected.length,
        phones: affected.map(a => a.phone_display),
      });
    }

    return affected.length;
  },

  async restoreAccounts(ids: string[]): Promise<number> {
    this.ensureInitialized();
    const affected: AccountRecord[] = [];

    (accountsCache || []).forEach(a => {
      if (ids.includes(a.id) && a.is_archived) {
        affected.push({ ...a });
        a.is_archived = false;
        a.archived_at = undefined;
        a.updated_at = new Date().toISOString();
      }
    });

    if (isSupabaseConfigured && ids.length > 0) {
      try {
        await supabase.from('accounts').update({
          is_archived: false,
          archived_at: null,
          updated_at: new Date().toISOString(),
        }).in('id', ids);
      } catch (err) {
        console.warn('Supabase restore failed:', err);
      }
    }

    if (affected.length > 0) {
      this.persistAccounts();
      this.pushUndo(`Restore ${affected.length} account(s)`, async () => {
        await this.archiveAccounts(affected.map(a => a.id));
      });
      await this.addAuditLog('RESTORE_ACCOUNTS', 'account', undefined, {
        count: affected.length,
        phones: affected.map(a => a.phone_display),
      });
    }

    return affected.length;
  },

  async permanentDeleteAccounts(ids: string[]): Promise<number> {
    this.ensureInitialized();
    const initialCount = (accountsCache || []).length;
    accountsCache = (accountsCache || []).filter(a => !ids.includes(a.id));
    const deletedCount = initialCount - accountsCache.length;

    if (isSupabaseConfigured && ids.length > 0) {
      try {
        await supabase.from('accounts').delete().in('id', ids);
      } catch (err) {
        console.warn('Supabase delete failed:', err);
      }
    }

    this.persistAccounts();
    await this.addAuditLog('PERMANENT_DELETE_ACCOUNTS', 'account', undefined, {
      count: deletedCount,
      ids,
    });

    return deletedCount;
  },

  // ----------------------------------------------------
  // ORDERS
  // ----------------------------------------------------
  async getOrders(params?: {
    accountId?: string;
    deliveryStatus?: string;
    refundStatus?: string;
    search?: string;
    mobileSearch?: string;
    limit?: number;
  }): Promise<OrderRecord[]> {
    this.ensureInitialized();

    if (isSupabaseConfigured) {
      try {
        let query = supabase.from('orders').select('*, accounts(phone_display, phone_normalized)');
        if (params?.accountId) query = query.eq('account_id', params.accountId);
        if (params?.deliveryStatus && params.deliveryStatus !== 'all') {
          query = query.eq('delivery_status', params.deliveryStatus);
        }
        if (params?.refundStatus && params.refundStatus !== 'all') {
          query = query.eq('refund_status', params.refundStatus);
        }

        // Mobile Number Search in Supabase
        if (params?.mobileSearch && params.mobileSearch.trim()) {
          const mQuery = params.mobileSearch.trim();
          const digits = mQuery.replace(/\D/g, '');
          let accFilter = supabase.from('accounts').select('id');
          if (digits.length > 0) {
            const digitsNo0 = digits.startsWith('0') ? digits.replace(/^0+/, '') : '';
            const digitsNo91 = digits.startsWith('91') && digits.length >= 10 ? digits.slice(2) : '';
            const orClauses = [
              `phone_normalized.ilike.%${digits}%`,
              `phone_display.ilike.%${mQuery}%`,
            ];
            if (digitsNo0) orClauses.push(`phone_normalized.ilike.%${digitsNo0}%`);
            if (digitsNo91) orClauses.push(`phone_normalized.ilike.%${digitsNo91}%`);
            accFilter = accFilter.or(orClauses.join(','));
          } else {
            accFilter = accFilter.ilike('phone_display', `%${mQuery}%`);
          }
          const { data: matchedAccs } = await accFilter;
          const matchingIds = (matchedAccs || []).map((a: any) => a.id);
          if (matchingIds.length === 0) {
            return [];
          }
          query = query.in('account_id', matchingIds);
        }

        if (params?.search && params.search.trim()) {
          const s = params.search.trim();
          const digits = s.replace(/\D/g, '');
          if (digits.length >= 3) {
            const { data: matchedAccs } = await supabase
              .from('accounts')
              .select('id')
              .or(`phone_normalized.ilike.%${digits}%,phone_display.ilike.%${s}%`);
            const phoneAccIds = (matchedAccs || []).map((a: any) => a.id);
            if (phoneAccIds.length > 0) {
              query = query.or(`external_order_id.ilike.%${s}%,product_name.ilike.%${s}%,tracking_id.ilike.%${s}%,account_id.in.(${phoneAccIds.join(',')})`);
            } else {
              query = query.or(`external_order_id.ilike.%${s}%,product_name.ilike.%${s}%,tracking_id.ilike.%${s}%`);
            }
          } else {
            query = query.or(`external_order_id.ilike.%${s}%,product_name.ilike.%${s}%,tracking_id.ilike.%${s}%`);
          }
        }
        query = query.order('order_date', { ascending: false });
        if (params?.limit) query = query.limit(params.limit);

        const { data, error } = await query;
        if (!error && data && data.length > 0) {
          return data.map((o: any) => ({
            ...o,
            account_phone: o.accounts?.phone_display || o.accounts?.phone_normalized || o.account_phone,
          })) as OrderRecord[];
        }
      } catch (err) {
        console.warn('Supabase getOrders failed:', err);
      }
    }

    let list = [...(ordersCache || [])];

    // Build map of accounts for fast lookup
    const accMap = new Map((accountsCache || []).map(a => [a.id, a]));
    list = list.map(o => {
      const acc = accMap.get(o.account_id);
      return {
        ...o,
        account_phone: o.account_phone || acc?.phone_display || acc?.phone_normalized,
      };
    });

    if (params?.accountId) {
      list = list.filter(o => o.account_id === params.accountId);
    }
    if (params?.deliveryStatus && params.deliveryStatus !== 'all') {
      list = list.filter(o => o.delivery_status === params.deliveryStatus);
    }
    if (params?.refundStatus && params.refundStatus !== 'all') {
      list = list.filter(o => o.refund_status === params.refundStatus);
    }

    // Specific Mobile Search filter
    if (params?.mobileSearch && params.mobileSearch.trim()) {
      const m = params.mobileSearch.trim();
      list = list.filter(o => {
        const acc = accMap.get(o.account_id);
        return (
          matchesMobileNumber(o.account_phone, m) ||
          matchesMobileNumber(acc?.phone_display, m) ||
          matchesMobileNumber(acc?.phone_normalized, m) ||
          matchesMobileNumber(acc?.account_json?.mobile, m) ||
          matchesMobileNumber(acc?.account_json?.phone, m)
        );
      });
    }

    // General Search filter
    if (params?.search && params.search.trim()) {
      const q = params.search.trim().toLowerCase();
      list = list.filter(o => {
        const acc = accMap.get(o.account_id);
        return (
          matchesMobileNumber(o.account_phone, q) ||
          matchesMobileNumber(acc?.phone_display, q) ||
          matchesMobileNumber(acc?.phone_normalized, q) ||
          (o.external_order_id || '').toLowerCase().includes(q) ||
          o.product_name.toLowerCase().includes(q) ||
          (o.sku || '').toLowerCase().includes(q) ||
          (o.tracking_id || '').toLowerCase().includes(q)
        );
      });
    }

    list.sort((a, b) => new Date(b.order_date).getTime() - new Date(a.order_date).getTime());

    if (params?.limit) {
      return list.slice(0, params.limit);
    }
    return list;
  },

  async createOrder(order: Omit<OrderRecord, 'id' | 'created_at' | 'updated_at'>): Promise<OrderRecord> {
    this.ensureInitialized();
    const now = new Date().toISOString();
    const isDelivered = order.delivery_status === 'delivered';
    const deliveredAt = order.delivered_at || (isDelivered ? (order.delivery_status_changed_at || order.terminal_confirmed_at || now) : undefined);
    const deliveryStatusChangedAt = order.delivery_status_changed_at || (isDelivered ? deliveredAt : undefined);
    const trackingId = order.tracking_id || extractTrackingId(order);

    if (isSupabaseConfigured) {
      try {
        const payload: any = {
          account_id: order.account_id,
          external_order_id: order.external_order_id || null,
          product_name: order.product_name,
          sku: order.sku || null,
          order_date: order.order_date || now,
          quantity: order.quantity || 1,
          order_amount: order.order_amount,
          payment_status: order.payment_status || 'paid',
          tracking_id: trackingId || null,
          delivery_status: order.delivery_status || 'placed',
          cancellation_status: order.cancellation_status || 'none',
          return_status: order.return_status || 'none',
          refund_status: order.refund_status || 'none',
          refund_amount: order.refund_amount || 0,
          refund_reference: order.refund_reference || null,
          data_source: order.data_source || 'manual',
          notes: order.notes || null,
          is_terminal: isDelivered,
          terminal_confirmed_at: isDelivered ? (order.terminal_confirmed_at || now) : null,
          delivered_at: deliveredAt || null,
          delivery_status_changed_at: deliveryStatusChangedAt || null,
          monitoring_status: isDelivered ? 'terminal_delivered' : 'monitoring',
        };
        const { data, error } = await supabase.from('orders').insert(payload).select().single();
        if (!error && data) {
          const ord = data as OrderRecord;
          ordersCache = [ord, ...(ordersCache || [])];
          this.persistOrders();
          await this.addAuditLog('CREATE_ORDER', 'order', ord.id, {
            product: ord.product_name,
            amount: ord.order_amount,
            delivered_at: ord.delivered_at,
            tracking_id: ord.tracking_id,
          });
          return ord;
        }
      } catch (err) {
        console.warn('Supabase createOrder failed:', err);
      }
    }

    const newOrd: OrderRecord = {
      ...order,
      id: `ord_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      tracking_id: trackingId,
      created_at: now,
      updated_at: now,
      delivered_at: deliveredAt,
      delivery_status_changed_at: deliveryStatusChangedAt,
      is_terminal: isDelivered,
      terminal_confirmed_at: isDelivered ? (order.terminal_confirmed_at || now) : undefined,
      monitoring_status: isDelivered ? 'terminal_delivered' : 'monitoring',
    };

    ordersCache = [newOrd, ...(ordersCache || [])];
    this.persistOrders();
    await this.addAuditLog('CREATE_ORDER', 'order', newOrd.id, {
      product: newOrd.product_name,
      amount: newOrd.order_amount,
      delivered_at: newOrd.delivered_at,
      tracking_id: newOrd.tracking_id,
    });
    return newOrd;
  },

  async updateOrderStatus(
    orderId: string,
    newDeliveryStatus?: any,
    newRefundStatus?: any,
    eventNote?: string,
    trackingId?: string
  ): Promise<OrderRecord | null> {
    this.ensureInitialized();
    const ord = (ordersCache || []).find(o => o.id === orderId);
    if (!ord) return null;

    const previousStatus = ord.delivery_status;
    const previousTracking = ord.tracking_id;
    const now = new Date().toISOString();

    // Critical Requirement 2: Do not overwrite a valid tracking ID with an empty or null value during subsequent synchronization.
    // If tracking ID is provided/extracted and non-empty, update it.
    if (trackingId !== undefined && trackingId !== null) {
      const extractedTracking = extractTrackingId(trackingId);
      if (extractedTracking && extractedTracking.trim()) {
        ord.tracking_id = extractedTracking.trim();
      }
    }

    if (newDeliveryStatus) {
      const isStatusChanged = ord.delivery_status !== newDeliveryStatus;
      ord.delivery_status = newDeliveryStatus;

      if (isStatusChanged) {
        ord.delivery_status_changed_at = now;
        ord.last_status_change_at = now;
      }

      if (newDeliveryStatus === 'delivered') {
        // Track the timestamp when the status FIRST changes to Delivered
        if (!ord.delivered_at) {
          ord.delivered_at = now;
        }
        ord.terminal_confirmed_at = ord.terminal_confirmed_at || ord.delivered_at;
        ord.is_terminal = true;
        ord.monitoring_status = 'terminal_delivered';
      }
    }
    if (newRefundStatus) ord.refund_status = newRefundStatus;
    ord.updated_at = now;
    if (eventNote) {
      ord.notes = ord.notes ? `${ord.notes}\n[${new Date().toLocaleDateString()}] ${eventNote}` : eventNote;
    }

    if (isSupabaseConfigured) {
      try {
        const updatePayload: any = {
          delivery_status: ord.delivery_status,
          refund_status: ord.refund_status,
          notes: ord.notes,
          updated_at: ord.updated_at,
          delivered_at: ord.delivered_at || null,
          delivery_status_changed_at: ord.delivery_status_changed_at || null,
        };
        if (ord.tracking_id) {
          updatePayload.tracking_id = ord.tracking_id;
        }
        if (ord.delivery_status === 'delivered') {
          updatePayload.is_terminal = true;
          updatePayload.terminal_confirmed_at = ord.terminal_confirmed_at || ord.updated_at;
          updatePayload.monitoring_status = 'terminal_delivered';
          updatePayload.delivered_at = ord.delivered_at;
        }
        await supabase.from('orders').update(updatePayload).eq('id', orderId);
      } catch (err) {
        console.warn('Supabase updateOrderStatus failed:', err);
      }
    }

    this.persistOrders();
    await this.addAuditLog('UPDATE_ORDER_STATUS', 'order', orderId, {
      from: previousStatus,
      to: newDeliveryStatus || ord.delivery_status,
      refundStatus: newRefundStatus || ord.refund_status,
      note: eventNote,
      delivered_at: ord.delivered_at,
      delivery_status_changed_at: ord.delivery_status_changed_at,
      tracking_id: ord.tracking_id,
      previous_tracking_id: previousTracking,
    });

    return ord;
  },

  async updateOrderTracking(orderId: string, trackingInput: any): Promise<OrderRecord | null> {
    this.ensureInitialized();
    const ord = (ordersCache || []).find(o => o.id === orderId);
    if (!ord) return null;

    const extracted = extractTrackingId(trackingInput);
    if (!extracted) {
      // Do not overwrite a valid tracking ID with an empty or null value
      return ord;
    }

    const previousTracking = ord.tracking_id;
    ord.tracking_id = extracted;
    ord.updated_at = new Date().toISOString();

    if (isSupabaseConfigured) {
      try {
        await supabase.from('orders').update({
          tracking_id: ord.tracking_id,
          updated_at: ord.updated_at,
        }).eq('id', orderId);
      } catch (err) {
        console.warn('Supabase updateOrderTracking failed:', err);
      }
    }

    this.persistOrders();
    await this.addAuditLog('UPDATE_ORDER_TRACKING', 'order', orderId, {
      fromTracking: previousTracking,
      toTracking: ord.tracking_id,
    });
    return ord;
  },

  // ----------------------------------------------------
  // SAVED FILTERS
  // ----------------------------------------------------
  async getSavedFilters(entityType?: string): Promise<SavedFilterRecord[]> {
    this.ensureInitialized();
    let list = [...(savedFiltersCache || [])];
    if (entityType) {
      list = list.filter(f => f.entity_type === entityType);
    }
    return list;
  },

  async saveFilter(filter: Omit<SavedFilterRecord, 'id' | 'created_at' | 'updated_at'>): Promise<SavedFilterRecord> {
    this.ensureInitialized();
    const newFlt: SavedFilterRecord = {
      ...filter,
      id: `flt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    savedFiltersCache = [newFlt, ...(savedFiltersCache || [])];
    this.persistFilters();
    return newFlt;
  },

  async deleteFilter(id: string): Promise<boolean> {
    this.ensureInitialized();
    savedFiltersCache = (savedFiltersCache || []).filter(f => f.id !== id);
    this.persistFilters();
    return true;
  },

  // ----------------------------------------------------
  // WORKER HEARTBEATS
  // ----------------------------------------------------
  async getLatestWorkerHeartbeats(limit: number = 5): Promise<WorkerHeartbeatRecord[]> {
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('worker_heartbeats')
          .select('*')
          .order('last_heartbeat', { ascending: false })
          .limit(limit);
        if (!error && data) return data as WorkerHeartbeatRecord[];
      } catch (err) {
        console.warn('Failed to load worker heartbeats:', err);
      }
    }
    return [];
  },

  // ----------------------------------------------------
  // AUDIT LOGS
  // ----------------------------------------------------
  async getAuditLogs(limit: number = 50): Promise<AuditLogRecord[]> {
    this.ensureInitialized();
    return (auditLogsCache || []).slice(0, limit);
  },

  async addAuditLog(
    action: string,
    entity_type: string,
    entity_id?: string,
    change_summary?: any,
    previous_state?: any,
    new_state?: any
  ): Promise<AuditLogRecord> {
    this.ensureInitialized();
    const log: AuditLogRecord = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      action,
      entity_type,
      entity_id,
      change_summary,
      previous_state,
      new_state,
      created_at: new Date().toISOString(),
    };
    auditLogsCache = [log, ...(auditLogsCache || [])].slice(0, 500); // keep 500 max in memory
    this.persistAuditLogs();
    return log;
  },

  // ----------------------------------------------------
  // UNDO SYSTEM
  // ----------------------------------------------------
  pushUndo(description: string, revertFn: () => Promise<void>) {
    undoStack.push({
      id: `undo_${Date.now()}`,
      description,
      timestamp: new Date().toISOString(),
      revert: revertFn,
    });
    if (undoStack.length > 20) undoStack.shift();
  },

  async popUndo(): Promise<{ success: boolean; description?: string }> {
    if (undoStack.length === 0) return { success: false };
    const item = undoStack.pop()!;
    try {
      await item.revert();
      return { success: true, description: item.description };
    } catch {
      return { success: false, description: item.description };
    }
  },

  getUndoStackCount(): number {
    return undoStack.length;
  },

  // ----------------------------------------------------
  // PERSISTENCE HELPERS
  // ----------------------------------------------------
  ensureInitialized() {
    if (accountsCache === null) {
      try {
        const stored = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
        if (stored) {
          accountsCache = JSON.parse(stored);
        } else {
          const seeds = initializeSeedData();
          accountsCache = seeds.accounts;
          ordersCache = seeds.orders;
          savedFiltersCache = seeds.savedFilters;
          this.persistAccounts();
          this.persistOrders();
          this.persistFilters();
        }
      } catch {
        const seeds = initializeSeedData();
        accountsCache = seeds.accounts;
      }
    }

    if (ordersCache === null) {
      try {
        const stored = localStorage.getItem(ORDERS_STORAGE_KEY);
        ordersCache = stored ? JSON.parse(stored) : [];
      } catch {
        ordersCache = [];
      }
    }
    // Strict requirement: Never preserve fake mock MSHO-ORD placeholder orders
    if (ordersCache && ordersCache.some(o => o.external_order_id?.startsWith('MSHO-ORD'))) {
      ordersCache = ordersCache.filter(o => !o.external_order_id?.startsWith('MSHO-ORD'));
      this.persistOrders();
    }
    // Auto-extract tracking ID for any existing orders where tracking was captured in notes
    if (ordersCache) {
      let trackingBackfilled = false;
      ordersCache.forEach(o => {
        if (!o.tracking_id && o.notes) {
          const found = extractTrackingId(o.notes);
          if (found) {
            o.tracking_id = found;
            trackingBackfilled = true;
          }
        }
      });
      if (trackingBackfilled) {
        this.persistOrders();
      }
    }

    if (savedFiltersCache === null) {
      try {
        const stored = localStorage.getItem(FILTERS_STORAGE_KEY);
        savedFiltersCache = stored ? JSON.parse(stored) : [];
      } catch {
        savedFiltersCache = [];
      }
    }

    if (auditLogsCache === null) {
      try {
        const stored = localStorage.getItem(AUDIT_STORAGE_KEY);
        auditLogsCache = stored ? JSON.parse(stored) : [];
      } catch {
        auditLogsCache = [];
      }
    }
  },

  persistAccounts() {
    if (typeof localStorage !== 'undefined' && accountsCache) {
      localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accountsCache));
    }
  },

  persistOrders() {
    if (typeof localStorage !== 'undefined' && ordersCache) {
      localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(ordersCache));
    }
  },

  persistFilters() {
    if (typeof localStorage !== 'undefined' && savedFiltersCache) {
      localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(savedFiltersCache));
    }
  },

  persistAuditLogs() {
    if (typeof localStorage !== 'undefined' && auditLogsCache) {
      localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(auditLogsCache));
    }
  },
};
