import React, { useState, useEffect } from 'react';
import { AccountRecord, OrderRecord, DeliveryAddress } from '../../types';
import { StorageService } from '../../lib/storageAdapter';
import {
  getAccountAssignedAddress,
  getAllKnownAddresses,
  savePresetAddress,
  validateAddressForCheckout,
} from '../../lib/addressStorage';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import { downloadSingleAccountJson, sanitizeAccountJsonForSafeCopy } from '../../lib/exportUtils';
import { Badge } from '../common/Badge';
import {
  X,
  Copy,
  Download,
  Lock,
  Unlock,
  ShoppingBag,
  AlertTriangle,
  Info,
  Calendar,
  FileCode,
  Tag,
  Check,
  Send,
  MapPin,
  MapPinOff,
  Plus,
  Home,
  Briefcase,
  Trash2,
} from 'lucide-react';
import { TelegramBotModal } from '../telegram/TelegramBotModal';

interface AccountDetailDrawerProps {
  account: AccountRecord | null;
  onClose: () => void;
  onViewOrders?: (account: AccountRecord) => void;
}

export const AccountDetailDrawer: React.FC<AccountDetailDrawerProps> = ({
  account,
  onClose,
  onViewOrders,
}) => {
  const { canViewSensitiveTokens, requestSensitiveAuthorization } = useAuth();
  const { showToast, refreshData } = useApp();

  const [revealSensitive, setRevealSensitive] = useState<boolean>(false);
  const [associatedOrders, setAssociatedOrders] = useState<OrderRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'json' | 'orders'>('overview');
  const [copied, setCopied] = useState<boolean>(false);
  const [isTgModalOpen, setIsTgModalOpen] = useState<boolean>(false);

  // Delivery Address State (Requirement 4)
  const [assignedAddress, setAssignedAddress] = useState<DeliveryAddress | null>(null);
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [modalAddressChoice, setModalAddressChoice] = useState<DeliveryAddress | null>(null);
  const [availablePresets, setAvailablePresets] = useState<DeliveryAddress[]>([]);
  const [isSavingAddress, setIsSavingAddress] = useState(false);
  const [isCreatingNewAddress, setIsCreatingNewAddress] = useState(false);

  // New address form state
  const [formName, setFormName] = useState('');
  const [formMobile, setFormMobile] = useState('');
  const [formPin, setFormPin] = useState('');
  const [formCity, setFormCity] = useState('');
  const [formState, setFormState] = useState('');
  const [formLine1, setFormLine1] = useState('');
  const [formLine2, setFormLine2] = useState('');
  const [formType, setFormType] = useState('Home');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (account) {
      StorageService.getOrders({ accountId: account.id }).then(orders => {
        setAssociatedOrders(orders);
      });
      setRevealSensitive(false);
      setAssignedAddress(getAccountAssignedAddress(account));
    }
  }, [account]);

  const openAddressModal = () => {
    const list = getAllKnownAddresses();
    setAvailablePresets(list);
    setModalAddressChoice(assignedAddress);
    setIsCreatingNewAddress(false);
    setFormError(null);
    setIsAddressModalOpen(true);
  };

  const handleSaveAddressToAccount = async () => {
    if (!account) return;
    setIsSavingAddress(true);
    try {
      await StorageService.assignAccountAddress(account.id, modalAddressChoice);
      setAssignedAddress(modalAddressChoice);
      showToast(
        modalAddressChoice
          ? `Assigned address (${modalAddressChoice.name}) to ${account.phone_display}`
          : `Removed address from ${account.phone_display}`,
        'success'
      );
      refreshData();
      setIsAddressModalOpen(false);
    } catch (err: any) {
      showToast(err?.message || 'Failed to update address', 'error');
    } finally {
      setIsSavingAddress(false);
    }
  };

  const handleRemoveAddressConfirm = async () => {
    if (!account) return;
    if (confirm(`Remove assigned address from account ${account.phone_display}?`)) {
      try {
        await StorageService.assignAccountAddress(account.id, null);
        setAssignedAddress(null);
        showToast(`Removed address from ${account.phone_display}`, 'success');
        refreshData();
      } catch (err: any) {
        showToast(err?.message || 'Failed to remove address', 'error');
      }
    }
  };

  const handleCreateAndSelectNewAddress = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const payload: Partial<DeliveryAddress> = {
      name: formName,
      mobile: formMobile,
      pin: formPin,
      city: formCity,
      state: formState,
      address_line_1: formLine1,
      address_line_2: formLine2,
      address_type: formType,
    };
    const val = validateAddressForCheckout(payload);
    if (!val.valid) {
      setFormError(val.error || 'Please fill required fields');
      return;
    }
    try {
      const saved = savePresetAddress(payload);
      const updated = getAllKnownAddresses();
      setAvailablePresets(updated);
      setModalAddressChoice(saved);
      setIsCreatingNewAddress(false);
      showToast('New address saved to presets and selected', 'info');
    } catch (err: any) {
      setFormError(err.message || 'Failed to save address');
    }
  };

  if (!account) return null;

  const handleCopy = async (full: boolean) => {
    try {
      const data = full && revealSensitive
        ? account.account_json
        : sanitizeAccountJsonForSafeCopy(account.account_json);
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      showToast(
        full && revealSensitive
          ? 'Full authorized JSON copied to clipboard'
          : 'Safe JSON copied (sensitive auth tokens masked)',
        'success'
      );
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Copy failed', 'error');
    }
  };

  const handleAuthorizeReveal = async () => {
    const granted = await requestSensitiveAuthorization();
    if (granted) {
      setRevealSensitive(true);
      showToast('Sensitive fields revealed for authorized session', 'info');
    } else {
      showToast('Permission denied. Admin or Ops Manager role required.', 'error');
    }
  };

  const displayJson = revealSensitive && canViewSensitiveTokens
    ? account.account_json
    : sanitizeAccountJsonForSafeCopy(account.account_json);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-slate-900 border-l border-slate-800 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/80">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-mono font-bold text-slate-100">
                {account.phone_display}
              </span>
              <Badge
                variant={
                  account.record_status === 'active'
                    ? 'success'
                    : account.record_status === 'sold'
                    ? 'primary'
                    : account.record_status === 'review_required'
                    ? 'warning'
                    : account.record_status === 'conflict'
                    ? 'danger'
                    : 'neutral'
                }
              >
                {account.record_status === 'sold' ? 'Sold (Excluded)' : account.record_status}
              </Badge>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Normalized: {account.phone_normalized}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsTgModalOpen(true)}
              className="p-2 text-slate-400 hover:text-pink-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title="Sync via @primes_meesho_bot"
            >
              <Send className="w-4 h-4 text-pink-400" />
            </button>
            <button
              onClick={() => downloadSingleAccountJson(account, revealSensitive)}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title="Download standalone .json"
            >
              <Download className="w-4 h-4 text-emerald-400" />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              aria-label="Close drawer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs inside Drawer */}
        <div className="flex border-b border-slate-800 bg-slate-900 px-6 gap-6 text-sm">
          <button
            onClick={() => setActiveTab('overview')}
            className={`py-3 font-medium transition-colors border-b-2 cursor-pointer ${
              activeTab === 'overview'
                ? 'border-pink-500 text-pink-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Overview & Warnings
          </button>
          <button
            onClick={() => setActiveTab('json')}
            className={`py-3 font-medium transition-colors border-b-2 flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'json'
                ? 'border-pink-500 text-pink-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileCode className="w-4 h-4" />
            <span>Account JSON</span>
          </button>
          <button
            onClick={() => setActiveTab('orders')}
            className={`py-3 font-medium transition-colors border-b-2 flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'orders'
                ? 'border-pink-500 text-pink-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShoppingBag className="w-4 h-4" />
            <span>Orders ({associatedOrders.length})</span>
          </button>
        </div>

        {/* Drawer Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Metadata Card */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Account Metadata
                </h4>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="text-slate-500">Source File:</span>
                    <p className="text-slate-200 font-mono mt-0.5">{account.source_file || 'Direct API/Manual'}</p>
                  </div>
                  <div>
                    <span className="text-slate-500">Record Created:</span>
                    <p className="text-slate-200 font-mono mt-0.5">{new Date(account.created_at).toLocaleString()}</p>
                  </div>
                  <div>
                    <span className="text-slate-500">Last Updated:</span>
                    <p className="text-slate-200 font-mono mt-0.5">{new Date(account.updated_at).toLocaleString()}</p>
                  </div>
                  <div>
                    <span className="text-slate-500">Associated Orders:</span>
                    <p className="text-slate-200 font-semibold mt-0.5">{associatedOrders.length} orders recorded</p>
                  </div>
                </div>

                {account.tags && account.tags.length > 0 && (
                  <div className="pt-2 border-t border-slate-800">
                    <span className="text-slate-500 text-xs block mb-1.5">Tags:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {account.tags.map((t, idx) => (
                        <Badge key={idx} variant="primary" size="sm">
                          <Tag className="w-2.5 h-2.5" />
                          <span>{t}</span>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {account.notes && (
                  <div className="pt-2 border-t border-slate-800 text-xs">
                    <span className="text-slate-500 block mb-1">Internal Notes:</span>
                    <p className="text-slate-300 bg-slate-900 p-2.5 rounded border border-slate-800 leading-relaxed">
                      {account.notes}
                    </p>
                  </div>
                )}
              </div>

              {/* Assigned Delivery Address Card (Requirement 4) */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-pink-400" />
                    <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      Assigned Delivery Address
                    </h4>
                  </div>
                  {assignedAddress ? (
                    <Badge variant="success" size="sm">
                      Address Assigned
                    </Badge>
                  ) : (
                    <Badge variant="neutral" size="sm">
                      No Address Assigned
                    </Badge>
                  )}
                </div>

                {assignedAddress ? (
                  <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-lg space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-semibold text-slate-200">
                        {assignedAddress.address_type === 'Work' ? (
                          <Briefcase className="w-3.5 h-3.5 text-cyan-400" />
                        ) : (
                          <Home className="w-3.5 h-3.5 text-emerald-400" />
                        )}
                        <span>{assignedAddress.name}</span>
                        <span className="text-[10px] text-slate-500 font-normal">
                          ({assignedAddress.address_type || 'Home'})
                        </span>
                      </div>
                      <span className="font-mono text-slate-400 text-[11px]">
                        +91 {assignedAddress.mobile}
                      </span>
                    </div>

                    <p className="text-slate-300 text-xs">
                      {assignedAddress.address_line_1}
                      {assignedAddress.address_line_2 ? `, ${assignedAddress.address_line_2}` : ''}
                    </p>

                    <p className="text-slate-400 text-xs">
                      {assignedAddress.city}, {assignedAddress.state} -{' '}
                      <strong className="text-slate-200 font-mono">{assignedAddress.pin}</strong>
                    </p>

                    <div className="flex items-center justify-between pt-2 mt-2 border-t border-slate-800/80">
                      <span className="text-[11px] text-slate-500">
                        {assignedAddress.id > 0
                          ? `Meesho Upstream ID: ${assignedAddress.id}`
                          : 'Locally Assigned Address'}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleRemoveAddressConfirm}
                          className="px-2.5 py-1 text-[11px] text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded border border-rose-900/50 transition-colors cursor-pointer"
                        >
                          Remove Address
                        </button>
                        <button
                          type="button"
                          onClick={openAddressModal}
                          className="px-2.5 py-1 text-[11px] font-semibold text-pink-300 bg-pink-950/80 hover:bg-pink-900/80 rounded border border-pink-700/60 transition-colors cursor-pointer"
                        >
                          Change Address
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-slate-900/50 border border-slate-800 rounded-lg flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2 text-slate-400">
                      <MapPinOff className="w-4 h-4 text-slate-500 shrink-0" />
                      <span>No delivery address assigned to this account.</span>
                    </div>
                    <button
                      type="button"
                      onClick={openAddressModal}
                      className="px-3 py-1.5 bg-pink-950/80 hover:bg-pink-900/80 text-pink-300 border border-pink-700/60 rounded-lg text-xs font-semibold transition-colors shrink-0 cursor-pointer"
                    >
                      Assign Address
                    </button>
                  </div>
                )}
              </div>

              {/* Data Quality & Conflict Warnings */}
              {account.record_status === 'sold' ? (
                <div className="bg-purple-950/40 border border-purple-800/80 rounded-xl p-4 space-y-2">
                  <div className="flex items-center gap-2 text-purple-300 font-semibold text-xs">
                    <Info className="w-4 h-4 shrink-0 text-purple-400" />
                    <span>Sold Account — Permanently Excluded</span>
                  </div>
                  <p className="text-xs text-purple-200/90 leading-relaxed">
                    This account is marked as <strong>Sold</strong>. It is permanently excluded from automatic background polling cycles and hidden from Direct Checkout & Pay.
                  </p>
                </div>
              ) : account.record_status !== 'active' ? (
                <div className="bg-amber-950/30 border border-amber-800/60 rounded-xl p-4 space-y-2">
                  <div className="flex items-center gap-2 text-amber-400 font-medium text-xs">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>Attention Required on this Account</span>
                  </div>
                  <p className="text-xs text-amber-200/80 leading-relaxed">
                    This account is marked as <strong>{account.record_status}</strong>. Please verify the
                    underlying mobile number, device tokens, or identity bindings in the CSV Reconciliation or
                    Data Quality Checker.
                  </p>
                </div>
              ) : null}

              {/* Quick Actions */}
              <div className="flex gap-3">
                <button
                  onClick={() => handleCopy(false)}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Safe Copy JSON</span>
                </button>
                <button
                  onClick={() => downloadSingleAccountJson(account, false)}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-pink-700 hover:bg-pink-600 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download .json</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'json' && (
            <div className="space-y-3">
              {/* Authorized Reveal Warning / Controls */}
              <div className="flex items-center justify-between bg-slate-950 p-3 rounded-lg border border-slate-800">
                <div className="flex items-center gap-2 text-xs">
                  {revealSensitive ? (
                    <>
                      <Unlock className="w-4 h-4 text-amber-400" />
                      <span className="text-amber-300 font-medium">Sensitive Tokens Unmasked (Authorized)</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4 text-emerald-400" />
                      <span className="text-slate-300">Sensitive Auth Tokens Masked</span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {!revealSensitive ? (
                    <button
                      onClick={handleAuthorizeReveal}
                      className="px-2.5 py-1 text-xs font-medium bg-amber-500/10 text-amber-300 border border-amber-600/40 hover:bg-amber-500/20 rounded transition-colors cursor-pointer"
                    >
                      Authorize Reveal
                    </button>
                  ) : (
                    <button
                      onClick={() => setRevealSensitive(false)}
                      className="px-2.5 py-1 text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 rounded transition-colors cursor-pointer"
                    >
                      Hide Tokens
                    </button>
                  )}

                  <button
                    onClick={() => handleCopy(true)}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 rounded transition-colors cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              {/* Formatted JSON Viewer */}
              <pre className="bg-slate-950 text-slate-200 p-4 rounded-xl border border-slate-800 font-mono text-xs overflow-x-auto max-h-[60vh] leading-relaxed select-text">
                {JSON.stringify(displayJson, null, 2)}
              </pre>
            </div>
          )}

          {activeTab === 'orders' && (
            <div className="space-y-3">
              {associatedOrders.length === 0 ? (
                <div className="text-center py-12 text-slate-400 bg-slate-950/60 rounded-xl border border-slate-800">
                  <ShoppingBag className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p className="text-sm font-medium text-slate-300">No orders associated with this account</p>
                  <p className="text-xs text-slate-500 mt-1">Orders imported with matching account ID or mobile will appear here.</p>
                </div>
              ) : (
                associatedOrders.map(order => (
                  <div
                    key={order.id}
                    className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2 hover:border-slate-700 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-200 text-sm">
                        {order.product_name}
                      </span>
                      <span className="font-mono font-bold text-pink-400 text-sm">
                        ₹{order.order_amount.toFixed(2)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <Badge variant="neutral" size="sm">
                        ID: {order.external_order_id || order.id}
                      </Badge>
                      <Badge
                        variant={
                          order.delivery_status === 'delivered'
                            ? 'success'
                            : order.delivery_status === 'cancelled'
                            ? 'danger'
                            : 'warning'
                        }
                        size="sm"
                      >
                        {order.delivery_status}
                      </Badge>
                      {order.refund_status !== 'none' && (
                        <Badge variant="warning" size="sm">
                          Refund: {order.refund_status}
                        </Badge>
                      )}
                      <span className="flex items-center gap-1 font-mono text-[11px] ml-auto">
                        <Calendar className="w-3 h-3" />
                        {new Date(order.order_date).toLocaleDateString()}
                      </span>
                    </div>

                    {order.notes && (
                      <p className="text-xs text-slate-400 bg-slate-900/80 p-2 rounded border border-slate-800/80">
                        {order.notes}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Telegram Bot Sync Modal */}
      <TelegramBotModal
        isOpen={isTgModalOpen}
        onClose={() => setIsTgModalOpen(false)}
        account={account}
        onSuccess={() => {
          setIsTgModalOpen(false);
          refreshData();
        }}
      />

      {/* Manual Address Assignment Modal (Requirement 4) */}
      {isAddressModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl relative space-y-4 max-h-[90vh] flex flex-col">
            <button
              onClick={() => setIsAddressModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-pink-950/80 border border-pink-700/60 flex items-center justify-center text-pink-400">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-slate-100 text-sm">
                  Assign Delivery Address: {account.phone_display}
                </h3>
                <p className="text-xs text-slate-400">
                  Select an address for this specific account. Requires explicit save confirmation.
                </p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {/* No Address Option */}
              <label
                onClick={() => setModalAddressChoice(null)}
                className={`p-3 rounded-xl border text-left cursor-pointer transition-all flex items-start justify-between gap-3 ${
                  modalAddressChoice == null
                    ? 'bg-pink-950/40 border-pink-500 text-slate-100 ring-1 ring-pink-500'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <MapPinOff className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-xs font-bold text-slate-200 block">No Address</span>
                    <span className="text-[11px] text-slate-400">
                      Remove assigned delivery address. Account remains address-free.
                    </span>
                  </div>
                </div>
                <input
                  type="radio"
                  name="modalAddressSelection"
                  checked={modalAddressChoice == null}
                  onChange={() => setModalAddressChoice(null)}
                  className="mt-1 text-pink-600 focus:ring-pink-500"
                />
              </label>

              {/* Saved Addresses List */}
              {availablePresets.map(addr => {
                const isSelected =
                  modalAddressChoice?.local_id === addr.local_id ||
                  (addr.id > 0 && modalAddressChoice?.id === addr.id);

                return (
                  <label
                    key={addr.local_id || addr.id}
                    onClick={() => setModalAddressChoice(addr)}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all flex items-start justify-between gap-3 ${
                      isSelected
                        ? 'bg-pink-950/40 border-pink-500 text-slate-100 ring-1 ring-pink-500'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      {addr.address_type === 'Work' ? (
                        <Briefcase className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
                      ) : (
                        <Home className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                      )}
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-200">{addr.name}</span>
                          <span className="text-[10px] text-slate-400 font-mono">+91 {addr.mobile}</span>
                        </div>
                        <p className="text-[11px] text-slate-300">{addr.address_line_1}</p>
                        <p className="text-[11px] text-slate-400">
                          {addr.city}, {addr.state} -{' '}
                          <strong className="text-slate-200 font-mono">{addr.pin}</strong>
                        </p>
                      </div>
                    </div>
                    <input
                      type="radio"
                      name="modalAddressSelection"
                      checked={isSelected}
                      onChange={() => setModalAddressChoice(addr)}
                      className="mt-1 text-pink-600 focus:ring-pink-500"
                    />
                  </label>
                );
              })}

              {/* Toggle Create New Address */}
              {!isCreatingNewAddress ? (
                <button
                  type="button"
                  onClick={() => {
                    setFormMobile(account.phone_display.replace(/\D/g, '').slice(-10));
                    setIsCreatingNewAddress(true);
                  }}
                  className="w-full py-2 bg-slate-950 hover:bg-slate-800/80 border border-dashed border-slate-700 rounded-xl text-xs font-semibold text-pink-400 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create & Select New Address</span>
                </button>
              ) : (
                <form onSubmit={handleCreateAndSelectNewAddress} className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200">New Address Details</span>
                    <button
                      type="button"
                      onClick={() => setIsCreatingNewAddress(false)}
                      className="text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {formError && (
                    <div className="p-2 rounded bg-rose-950/60 border border-rose-800 text-[11px] text-rose-300">
                      {formError}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      required
                      value={formName}
                      onChange={e => setFormName(e.target.value)}
                      placeholder="Recipient Name *"
                      className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
                    />
                    <input
                      type="tel"
                      required
                      maxLength={10}
                      value={formMobile}
                      onChange={e => setFormMobile(e.target.value.replace(/\D/g, ''))}
                      placeholder="10-digit mobile *"
                      className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 font-mono"
                    />
                  </div>

                  <input
                    type="text"
                    required
                    value={formLine1}
                    onChange={e => setFormLine1(e.target.value)}
                    placeholder="Address Line 1 (Flat, House, Street) *"
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
                  />

                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      required
                      maxLength={6}
                      value={formPin}
                      onChange={e => setFormPin(e.target.value.replace(/\D/g, ''))}
                      placeholder="PIN Code *"
                      className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 font-mono"
                    />
                    <input
                      type="text"
                      required
                      value={formCity}
                      onChange={e => setFormCity(e.target.value)}
                      placeholder="City *"
                      className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
                    />
                    <input
                      type="text"
                      required
                      value={formState}
                      onChange={e => setFormState(e.target.value)}
                      placeholder="State *"
                      className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsCreatingNewAddress(false)}
                      className="px-3 py-1 text-xs text-slate-400 hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-1 bg-pink-700 hover:bg-pink-600 text-white text-xs font-semibold rounded"
                    >
                      Add & Select
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsAddressModalOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={isSavingAddress}
                onClick={handleSaveAddressToAccount}
                className="flex items-center gap-1.5 px-5 py-2 bg-pink-700 hover:bg-pink-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-md transition-colors cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{isSavingAddress ? 'Saving Address...' : 'Save Address to Account'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
