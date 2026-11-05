import React, { useState } from 'react';
import { DeliveryAddress } from '../../types';
import {
  saveDeliveryAddress,
  deleteSavedAddress,
  validateAddressForCheckout,
} from '../../lib/addressStorage';
import { CheckoutApi } from '../../lib/checkoutApi';
import {
  MapPin,
  Plus,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Edit2,
  Sparkles,
  RefreshCw,
  Home,
  Briefcase,
  Navigation,
  X,
  Users,
  Check,
} from 'lucide-react';

interface AddressManagerProps {
  accountId: number | string | null;
  addresses: DeliveryAddress[];
  selectedAddress: DeliveryAddress | null;
  onSelectAddress: (address: DeliveryAddress) => void;
  onAddressListChange: () => void;
  addressError?: string | null;
  onClearAddressError?: () => void;
  isLoading?: boolean;
}

export const AddressManager: React.FC<AddressManagerProps> = ({
  accountId,
  addresses,
  selectedAddress,
  onSelectAddress,
  onAddressListChange,
  addressError,
  onClearAddressError,
  isLoading,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<DeliveryAddress | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [registeringId, setRegisteringId] = useState<string | number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Address Form State
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [pin, setPin] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [landmark, setLandmark] = useState('');
  const [addressType, setAddressType] = useState('Home');
  const [syncToMeesho, setSyncToMeesho] = useState(true);

  const openAddModal = () => {
    setEditingAddress(null);
    setName('');
    setMobile('');
    setPin('');
    setCity('');
    setState('');
    setLine1('');
    setLine2('');
    setLandmark('');
    setAddressType('Home');
    setSyncToMeesho(true);
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (addr: DeliveryAddress, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingAddress(addr);
    setName(addr.name);
    setMobile(addr.mobile);
    setPin(addr.pin);
    setCity(addr.city);
    setState(addr.state);
    setLine1(addr.address_line_1);
    setLine2(addr.address_line_2 || '');
    setLandmark(addr.landmark || '');
    setAddressType(addr.address_type || 'Home');
    setSyncToMeesho(!addr.is_upstream_registered);
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleDelete = (addr: DeliveryAddress, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!accountId) return;
    if (confirm(`Remove saved address for "${addr.name}"?`)) {
      deleteSavedAddress(accountId, addr.local_id || addr.id);
      onAddressListChange();
    }
  };

  const handleRegisterOnMeesho = async (addr: DeliveryAddress, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!accountId) return;
    setRegisteringId(addr.local_id || addr.id);
    try {
      const res = await CheckoutApi.createAddress({
        name: addr.name,
        mobile: addr.mobile,
        pin: addr.pin,
        city: addr.city,
        state: addr.state,
        address_line_1: addr.address_line_1,
        address_line_2: addr.address_line_2,
        landmark: addr.landmark,
        address_type: addr.address_type,
      });

      if (res.ok && res.address) {
        // Save the upstream verified address locally
        saveDeliveryAddress(accountId, {
          ...addr,
          id: res.address.id,
          is_upstream_registered: true,
        });
        onAddressListChange();
        onSelectAddress(res.address);
      }
    } catch (err: any) {
      alert(`Could not register address with Meesho: ${err.message}`);
    } finally {
      setRegisteringId(null);
    }
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId) return;
    setFormError(null);

    const payload: Partial<DeliveryAddress> = {
      local_id: editingAddress?.local_id,
      id: editingAddress?.id || 0,
      name,
      mobile,
      pin,
      city,
      state,
      address_line_1: line1,
      address_line_2: line2,
      landmark,
      address_type: addressType,
    };

    const val = validateAddressForCheckout(payload);
    if (!val.valid) {
      setFormError(val.error || 'Please check the required fields');
      return;
    }

    setIsSubmitting(true);
    try {
      let finalUpstreamAddress: DeliveryAddress | undefined;

      // Register with Meesho upstream if requested or if already has upstream ID
      if (syncToMeesho) {
        try {
          const res = await CheckoutApi.createAddress({
            ...payload,
            id: editingAddress?.id ? editingAddress.id : undefined,
          });
          if (res.ok && res.address) {
            finalUpstreamAddress = res.address;
            payload.id = res.address.id;
            payload.is_upstream_registered = true;
          }
        } catch (upstreamErr: any) {
          console.warn('Upstream address registration error:', upstreamErr);
          // Keep locally saved even if upstream failed, but notify user
          setFormError(`Saved locally, but Meesho registration failed: ${upstreamErr.message}`);
        }
      }

      const saved = saveDeliveryAddress(accountId, {
        ...payload,
        id: finalUpstreamAddress?.id || payload.id,
        is_upstream_registered: Boolean(finalUpstreamAddress?.id || payload.is_upstream_registered),
      });

      onAddressListChange();
      if (finalUpstreamAddress || saved.is_upstream_registered) {
        onSelectAddress(finalUpstreamAddress || saved);
      }
      setIsModalOpen(false);
    } catch (err: any) {
      setFormError(err.message || 'Failed to save address');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm backdrop-blur-sm space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-pink-400" />
          <h3 className="font-semibold text-slate-100 text-base">Delivery Address</h3>
          <span className="text-xs text-slate-400">
            ({addresses.length} available)
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">

          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pink-600/20 hover:bg-pink-600/30 text-pink-400 border border-pink-500/30 text-xs font-semibold transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Add New Address
          </button>
        </div>
      </div>

      {/* Address Expiration / HTTP 410 Warning Banner */}
      {addressError && (
        <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-600/50 flex items-start justify-between gap-3 text-xs text-amber-200 shadow-md">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <strong className="block text-amber-300 font-semibold text-xs">
                Address Unavailable or Expired
              </strong>
              <span>{addressError}</span>
            </div>
          </div>
          {onClearAddressError && (
            <button
              type="button"
              onClick={onClearAddressError}
              className="text-amber-400 hover:text-white p-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Address Cards List */}
      {addresses.length === 0 ? (
        <div className="text-center py-8 text-slate-400 text-xs space-y-2 border border-dashed border-slate-800 rounded-xl">
          <MapPin className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="font-medium text-slate-300">No delivery addresses found for this account.</p>
          <p className="text-slate-500 max-w-sm mx-auto">
            Click "Add New Address" above to save your delivery location and register it with Meesho for checkout.
          </p>
          <button
            type="button"
            onClick={openAddModal}
            className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-pink-600 hover:bg-pink-500 text-white font-semibold text-xs transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Add Delivery Address
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {addresses.map(addr => {
            const isSelected = selectedAddress?.id === addr.id && addr.id > 0;
            const isRegistered = Boolean(addr.is_upstream_registered && addr.id > 0);

            return (
              <div
                key={addr.local_id || addr.id}
                onClick={() => {
                  if (isRegistered) {
                    onSelectAddress(addr);
                  }
                }}
                className={`p-3.5 rounded-xl border transition-all text-left relative flex flex-col justify-between ${
                  isSelected
                    ? 'border-pink-500 bg-pink-950/20 text-white shadow-sm ring-1 ring-pink-500/50'
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                } ${isRegistered ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-200">{addr.name}</span>
                      <span className="text-[10px] bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded uppercase font-semibold flex items-center gap-1">
                        {addr.address_type === 'Work' ? <Briefcase className="w-2.5 h-2.5" /> : <Home className="w-2.5 h-2.5" />}
                        {addr.address_type || 'Home'}
                      </span>
                    </div>

                    {/* Upstream Status Badge */}
                    {isRegistered ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-medium bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800/60">
                        <CheckCircle2 className="w-2.5 h-2.5" /> Meesho Verified
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 font-medium bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-800/60">
                        <AlertCircle className="w-2.5 h-2.5" /> Saved Locally
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-300 line-clamp-2">
                    {addr.address_line_1}{addr.address_line_2 ? `, ${addr.address_line_2}` : ''}
                  </p>
                  {addr.landmark && (
                    <p className="text-[11px] text-slate-400 italic">Near: {addr.landmark}</p>
                  )}
                  <p className="text-xs text-slate-400 mt-1">
                    {addr.city}, {addr.state} - <strong className="text-slate-200 font-mono">{addr.pin}</strong>
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5 font-mono">Ph: +91 {addr.mobile}</p>
                </div>

                {/* Actions & Selection Footer */}
                <div className="flex items-center justify-between pt-3 mt-2 border-t border-slate-800/60">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => openEditModal(addr, e)}
                      className="p-1 text-slate-400 hover:text-slate-200 rounded transition-colors"
                      title="Edit Address"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDelete(addr, e)}
                      className="p-1 text-slate-400 hover:text-rose-400 rounded transition-colors"
                      title="Delete Locally Saved Address"
                    >
                    </button>
                  </div>

                  {!isRegistered ? (
                    <button
                      type="button"
                      disabled={registeringId === (addr.local_id || addr.id)}
                      onClick={(e) => handleRegisterOnMeesho(addr, e)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-pink-600 hover:bg-pink-500 text-white text-[11px] font-semibold transition-colors disabled:opacity-50 cursor-pointer shadow-sm"
                    >
                      {registeringId === (addr.local_id || addr.id) ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin" /> Registering...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3 h-3" /> Register with Meesho
                        </>
                      )}
                    </button>
                  ) : (
                    <div className="text-[11px] font-semibold">
                      {isSelected ? (
                        <span className="text-pink-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Selected
                        </span>
                      ) : (
                        <span className="text-slate-500 hover:text-pink-400">
                          Click to Select
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Address Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950/60">
              <h3 className="font-bold text-white text-base flex items-center gap-2">
                <MapPin className="w-4 h-4 text-pink-400" />
                {editingAddress ? 'Edit Delivery Address' : 'Add New Delivery Address'}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveForm} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
              {formError && (
                <div className="p-3 rounded-lg bg-rose-950/50 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Recipient Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-100 focus:ring-1 focus:ring-pink-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Mobile Number (10 digits) *
                  </label>
                  <div className="flex">
                    <span className="inline-flex items-center px-2.5 rounded-l-lg border border-r-0 border-slate-800 bg-slate-950 text-slate-400 text-xs">
                      +91
                    </span>
                    <input
                      type="tel"
                      required
                      maxLength={10}
                      value={mobile}
                      onChange={e => setMobile(e.target.value.replace(/\D/g, ''))}
                      placeholder="9876543210"
                      className="w-full bg-slate-950 border border-slate-800 rounded-r-lg p-2.5 text-sm text-slate-100 focus:ring-1 focus:ring-pink-500 focus:outline-none font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    PIN Code (6 digits) *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={pin}
                    onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="e.g. 110001"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-100 focus:ring-1 focus:ring-pink-500 focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    City *
                  </label>
                  <input
                    type="text"
                    required
                    value={city}
                    onChange={e => setCity(e.target.value)}
                    placeholder="e.g. New Delhi"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-100 focus:ring-1 focus:ring-pink-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    State *
                  </label>
                  <input
                    type="text"
                    required
                    value={state}
                    onChange={e => setState(e.target.value)}
                    placeholder="e.g. Delhi"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-100 focus:ring-1 focus:ring-pink-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  House / Flat / Building / Street *
                </label>
                <input
                  type="text"
                  required
                  value={line1}
                  onChange={e => setLine1(e.target.value)}
                  placeholder="e.g. Flat 101, Connaught Place"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-100 focus:ring-1 focus:ring-pink-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Area / Colony / Road (Optional)
                </label>
                <input
                  type="text"
                  value={line2}
                  onChange={e => setLine2(e.target.value)}
                  placeholder="e.g. Barakhamba Road"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-100 focus:ring-1 focus:ring-pink-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Nearby Landmark (Optional)
                </label>
                <input
                  type="text"
                  value={landmark}
                  onChange={e => setLandmark(e.target.value)}
                  placeholder="e.g. Near Metro Station"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-100 focus:ring-1 focus:ring-pink-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Address Type
                </label>
                <div className="flex gap-2">
                  {['Home', 'Work', 'Other'].map(type => (
                    <button
                      type="button"
                      key={type}
                      onClick={() => setAddressType(type)}
                      className={`flex-1 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                        addressType === type
                          ? 'border-pink-500 bg-pink-950/40 text-white ring-1 ring-pink-500'
                          : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-white'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-pink-950/20 border border-pink-500/20">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncToMeesho}
                    onChange={e => setSyncToMeesho(e.target.checked)}
                    className="mt-0.5 rounded border-slate-700 text-pink-600 focus:ring-pink-500"
                  />
                  <div>
                    <span className="text-xs font-semibold text-pink-300 block">
                      Register with Meesho for Checkout
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Registers this address on Meesho via the authorized backend so it receives a verified Meesho address ID for checkout.
                    </span>
                  </div>
                </label>
              </div>


              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-lg bg-pink-600 hover:bg-pink-500 text-white font-bold text-xs tracking-wide transition-all disabled:opacity-50 cursor-pointer flex items-center gap-1.5 shadow-md shadow-pink-900/30"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving...
                    </>
                  ) : (
                    'Save Address'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


    </div>
  );
};
