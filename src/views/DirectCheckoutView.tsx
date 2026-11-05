import React, { useState, useEffect, useCallback } from 'react';
import {
  ProductDetail,
  ProductVariation,
  DeliveryAddress,
  CheckoutQuote,
  ProductSearchResultItem,
  AutoAddCartResult,
  InternalCheckoutStatus,
  OrderPaymentStatus,
} from '../types';
import { CheckoutApi } from '../lib/checkoutApi';
import { StorageService } from '../lib/storageAdapter';
import { useApp } from '../context/AppContext';
import { PriceCard } from '../components/checkout/PriceCard';
import { GPayModal } from '../components/checkout/GPayModal';
import { AddressManager } from '../components/checkout/AddressManager';
import { mergeAccountAddresses } from '../lib/addressStorage';
import { PaymentConfig } from '../lib/paymentConfig';
import { checkoutSyncManager } from '../lib/checkoutSyncManager';
import {
  filterAccountsWithoutConfirmedOrders,
  CheckoutAccountItem,
  VerifiedOrderRecord,
} from '../lib/checkoutEligibility';
import {
  Search,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Truck,
  ChevronRight,
  User,
  RefreshCw,
  ShieldAlert,
  PackageCheck,
  Package,
  X,
  Download,
  ShoppingCart,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { exportDirectCheckoutAccountsJson } from '../lib/exportUtils';

export const DirectCheckoutView: React.FC = () => {
  const { showToast, setActiveTab } = useApp();

  // Step 1: Product Search & Resolution State
  const [searchQuery, setSearchQuery] = useState<string>('https://www.meesho.com/s/p/hf38yb');
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<ProductSearchResultItem[]>([]);
  const [resolvingProduct, setResolvingProduct] = useState<boolean>(false);
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariation | null>(null);
  const [quantity, setQuantity] = useState<number>(1);
  const [selectedImage, setSelectedImage] = useState<string>('');
  const [productError, setProductError] = useState<string | null>(null);
  const [isCartIsolating, setIsCartIsolating] = useState<boolean>(false);
  const [cartIsolationError, setCartIsolationError] = useState<string | null>(null);

  // Auto-Add Product to Cart State (0-order accounts automation)
  const [isAutoAddingCart, setIsAutoAddingCart] = useState<boolean>(false);
  const [autoAddCartModalOpen, setAutoAddCartModalOpen] = useState<boolean>(false);
  const [autoAddCartResult, setAutoAddCartResult] = useState<AutoAddCartResult | null>(null);
  const [autoAddCartError, setAutoAddCartError] = useState<string | null>(null);

  // Step 2: Account & Address State (Filtered for 0-order accounts)
  const [accounts, setAccounts] = useState<CheckoutAccountItem[]>([]);
  const [eligibleAccounts, setEligibleAccounts] = useState<CheckoutAccountItem[]>([]);
  const [orders, setOrders] = useState<VerifiedOrderRecord[]>([]);
  const [verifyingEligibility, setVerifyingEligibility] = useState<boolean>(false);
  const [ordersVerificationError, setOrdersVerificationError] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [addresses, setAddresses] = useState<DeliveryAddress[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<DeliveryAddress | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);

  // Step 3: Cart & Pricing State
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState<boolean>(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'online' | 'cod'>('online');

  // Step 4: Placing & Payment State (Authorized Free Mode & Live Payment Sync)
  const [isFreePaymentMode, setIsFreePaymentMode] = useState<boolean>(PaymentConfig.isFreePaymentMode());
  const [isPlacingFreeOrder, setIsPlacingFreeOrder] = useState<boolean>(false);
  const [activeCheckoutRef, setActiveCheckoutRef] = useState<string>('');
  const [isPlacingCod, setIsPlacingCod] = useState<boolean>(false);
  const [isGPayModalOpen, setIsGPayModalOpen] = useState<boolean>(false);
  const [confirmedOrder, setConfirmedOrder] = useState<{
    orderNum: string;
    amount: number;
    paymentMode: string;
    productName: string;
    variantName?: string;
    quantity: number;
    address: string;
    checkoutReference?: string;
    internalStatus?: InternalCheckoutStatus;
    merchantPaymentStatus?: string;
  } | null>(null);

  // Subscribe to external changes in Free Payment Mode
  useEffect(() => {
    const unsub = PaymentConfig.subscribe(enabled => {
      setIsFreePaymentMode(enabled);
    });
    return unsub;
  }, []);

  // Load Accounts & Addresses on mount and filter out accounts with confirmed orders
  const loadInitialData = useCallback(async () => {
    setVerifyingEligibility(true);
    setOrdersVerificationError(null);
    try {
      const [shopAccsRes, dbAccsRes, dbOrdersRes, addrsRes] = await Promise.all([
        CheckoutApi.getAccounts().catch(() => []),
        StorageService.getAccounts({ pageSize: 1000, includeArchived: true }).catch(() => ({ accounts: [] })),
        StorageService.getOrders().catch(err => {
          throw new Error(`Database error: ${err?.message || 'Failed to verify order history'}`);
        }),
        CheckoutApi.getAddresses().catch(() => []),
      ]);

      const getPhoneKey = (val: any): string => {
        const d = String(val || '').replace(/\D/g, '');
        return d.length >= 10 ? d.slice(-10) : d;
      };

      const dbAccsList = Array.isArray(dbAccsRes) ? dbAccsRes : ((dbAccsRes as any)?.accounts || []);
      const dbAccountMap = new Map<string, any>();
      dbAccsList.forEach((dba: any) => {
        const k1 = getPhoneKey(dba.phone_normalized);
        const k2 = getPhoneKey(dba.phone_display);
        const k3 = getPhoneKey(dba.account_json?.mobile);
        if (k1) dbAccountMap.set(k1, dba);
        if (k2) dbAccountMap.set(k2, dba);
        if (k3) dbAccountMap.set(k3, dba);
        if (dba.id) dbAccountMap.set(String(dba.id).trim(), dba);
      });

      const enrichedAccounts: CheckoutAccountItem[] = (shopAccsRes || []).map((sa: any) => {
        const cleanMobile = getPhoneKey(sa.mobile);
        const dba = dbAccountMap.get(cleanMobile);
        return {
          id: sa.id,
          mobile: sa.mobile,
          supabase_id: dba?.id,
          user_id: sa.user_id,
          status: dba?.record_status || dba?.status || sa.status || sa.record_status,
          record_status: dba?.record_status || sa.record_status,
          monitoring_status: dba?.monitoring_status || sa.monitoring_status,
          total_orders_discovered: dba?.total_orders_discovered,
          order_placed: sa.order_placed,
          tags: dba?.tags || sa.tags,
          account_json: dba?.account_json,
        };
      });

      const verifiedOrders: VerifiedOrderRecord[] = (dbOrdersRes || []).map((o: any) => ({
        id: o.id,
        account_id: String(o.account_id || ''),
        external_order_id: o.external_order_id,
        delivery_status: o.delivery_status,
        payment_status: o.payment_status,
        cancellation_status: o.cancellation_status,
      }));

      // Apply filtering using stable IDs and confirmed order history
      const filterResult = filterAccountsWithoutConfirmedOrders(enrichedAccounts, verifiedOrders);

      setAccounts(enrichedAccounts);
      setOrders(verifiedOrders);
      setEligibleAccounts(filterResult.eligibleAccounts);

      if (filterResult.eligibleAccounts.length > 0) {
        const firstEligible = filterResult.eligibleAccounts[0];
        setSelectedAccountId(Number(firstEligible.id));
        await CheckoutApi.selectAccount(Number(firstEligible.id)).catch(() => {});
        const freshAddrs = await CheckoutApi.getAddresses().catch(() => addrsRes);
        const mergedAddrs = mergeAccountAddresses(firstEligible.id, freshAddrs);
        setAddresses(mergedAddrs);
        const verified = mergedAddrs.filter(a => a.is_upstream_registered && a.id > 0);
        if (verified.length > 0) setSelectedAddress(verified[0]);
        else setSelectedAddress(null);
      } else {
        setSelectedAccountId(null);
        setAddresses([]);
        setSelectedAddress(null);
      }
    } catch (err: any) {
      console.warn('Failed to verify account eligibility:', err);
      setOrdersVerificationError(err.message || 'Unable to verify order history');
      setEligibleAccounts([]);
      setSelectedAccountId(null);
    } finally {
      setVerifyingEligibility(false);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Reload addresses for active account
  const reloadAddresses = useCallback(async () => {
    if (!selectedAccountId) return;
    try {
      const freshAddrs = await CheckoutApi.getAddresses().catch(() => []);
      const mergedAddrs = mergeAccountAddresses(selectedAccountId, freshAddrs);
      setAddresses(mergedAddrs);
      if (selectedAddress) {
        const stillValid = mergedAddrs.find(
          a => (a.id > 0 && a.id === selectedAddress.id) || (a.local_id && a.local_id === selectedAddress.local_id)
        );
        if (stillValid) setSelectedAddress(stillValid);
      }
    } catch (err) {
      console.warn('Failed to reload addresses:', err);
    }
  }, [selectedAccountId, selectedAddress]);

  // Handle Account Change
  const handleSelectAccount = async (acctId: number) => {
    setSelectedAccountId(acctId);
    setAddressError(null);
    try {
      await CheckoutApi.selectAccount(acctId);
      showToast('Switched active checkout account', 'info');
      const freshAddrs = await CheckoutApi.getAddresses().catch(() => []);
      const mergedAddrs = mergeAccountAddresses(acctId, freshAddrs);
      setAddresses(mergedAddrs);
      const verified = mergedAddrs.filter(a => a.is_upstream_registered && a.id > 0);
      if (verified.length > 0) {
        setSelectedAddress(verified[0]);
        refreshQuote(verified[0].id);
      } else {
        setSelectedAddress(null);
        refreshQuote(null);
      }
    } catch (err: any) {
      showToast(`Account switch failed: ${err.message}`, 'error');
    }
  };

  // Helper to isolate cart for a specific product, variant, and quantity
  const isolateTargetProductInCart = useCallback(async (
    targetProduct: ProductDetail,
    targetVariant: ProductVariation,
    targetQty: number
  ): Promise<boolean> => {
    // Rule 6: Handle uncertain order history safely. If order history cannot be verified, skip!
    if (ordersVerificationError) {
      const msg = `Cannot modify cart: order history verification required (${ordersVerificationError}).`;
      setCartIsolationError(msg);
      return false;
    }

    // Rule 1, 3, 8: Verify account eligibility and confirm no successful orders exist
    if (selectedAccountId) {
      const isEligible = eligibleAccounts.some(a => Number(a.id) === Number(selectedAccountId));
      if (!isEligible) {
        const msg = `Account #${selectedAccountId} cannot be modified: already placed an order, is marked Sold, or unverified.`;
        setCartIsolationError(msg);
        return false;
      }
    }

    setIsCartIsolating(true);
    setCartIsolationError(null);
    try {
      const res = await CheckoutApi.isolateCart({
        productId: targetProduct.product_id,
        supplierId: targetProduct.supplier_id,
        variationId: targetVariant.variation_id,
        variationName: targetVariant.name,
        quantity: targetQty,
      });

      if (!res.is_isolated) {
        throw new Error('Could not isolate product in cart');
      }
      return true;
    } catch (err: any) {
      const msg = err.message || 'Cart isolation failed';
      setCartIsolationError(msg);
      showToast(msg, 'error');
      return false;
    } finally {
      setIsCartIsolating(false);
    }
  }, [showToast, ordersVerificationError, selectedAccountId, eligibleAccounts]);

  // Synchronize Cart and Refresh Quote (strictly single product)
  const refreshQuote = useCallback(async (addrId?: number | null) => {
    const activeAddr = addrId !== undefined
      ? addresses.find(a => a.id === addrId) || selectedAddress
      : selectedAddress;

    const verifiedAddrId = activeAddr && activeAddr.id > 0 && activeAddr.is_upstream_registered !== false
      ? activeAddr.id
      : null;

    setQuoteLoading(true);
    setQuoteError(null);

    try {
      // 1. If we have an active product and variant, isolate cart strictly to this item ONLY if account is verified eligible
      const isAccountEligible = Boolean(
        !ordersVerificationError &&
        selectedAccountId &&
        eligibleAccounts.some(a => Number(a.id) === Number(selectedAccountId))
      );

      if (product && selectedVariant && isAccountEligible) {
        await CheckoutApi.isolateCart({
          productId: product.product_id,
          supplierId: product.supplier_id,
          variationId: selectedVariant.variation_id,
          variationName: selectedVariant.name,
          quantity,
        }).catch((err) => {
          console.warn('Cart isolation notice:', err);
        });
      }

      // 2. If we have a verified address, bind location to remote cart (safe & non-blocking)
      if (verifiedAddrId && activeAddr) {
        try {
          await CheckoutApi.setCartLocation(activeAddr.id, activeAddr.pin);
        } catch (locErr) {
          console.warn('Set cart location non-blocking notice:', locErr);
        }
      }

      // 3. Fetch quote with target product context (never sends address_id: null to avoid HTTP 410)
      const q = await CheckoutApi.getQuote(verifiedAddrId, product?.product_id);
      setQuote(q);
      setAddressError(null);
    } catch (err: any) {
      const msg = err.message || 'Could not fetch verified quote';
      if (msg.includes('Address not found') || msg.includes('unavailable or has expired')) {
        setAddressError('Your selected delivery address is unavailable or has expired. Please select another verified address.');
        setSelectedAddress(null);
      } else {
        setQuoteError(msg);
      }
    } finally {
      setQuoteLoading(false);
    }
  }, [product, selectedVariant, quantity, selectedAddress, addresses]);

  // Recalculate quote when variant, quantity, or address changes
  useEffect(() => {
    if (product && selectedVariant) {
      const targetId = selectedAddress?.is_upstream_registered && selectedAddress.id > 0 ? selectedAddress.id : null;
      refreshQuote(targetId);
    }
  }, [product, selectedVariant, quantity, selectedAddress, refreshQuote]);

  // Handle explicit selection of a product (by numeric ID, link, or card click)
  const handleSelectProduct = async (productIdOrLink: string | number) => {
    setResolvingProduct(true);
    setProductError(null);
    setCartIsolationError(null);
    setQuote(null);
    setConfirmedOrder(null);

    try {
      const res = await CheckoutApi.resolveProduct(String(productIdOrLink));
      setProduct(res);

      if (res.images && res.images.length > 0) {
        setSelectedImage(res.images[0]);
      } else {
        setSelectedImage('');
      }

      // Default to first in-stock variant
      let chosenVariant: ProductVariation | null = null;
      if (res.sizes && res.sizes.length > 0) {
        chosenVariant = res.sizes.find(s => s.in_stock) || res.sizes[0];
        setSelectedVariant(chosenVariant);
      } else {
        setSelectedVariant(null);
      }

      setQuantity(1);
      showToast(`Selected: ${res.name.slice(0, 35)}...`, 'success');

      // Immediately isolate remote cart to ONLY this selected product
      if (chosenVariant) {
        await isolateTargetProductInCart(res, chosenVariant, 1);
      }

      // Fetch quote for this single isolated product
      refreshQuote(selectedAddress?.id || null);
    } catch (err: any) {
      setProductError(err.message || 'Could not resolve product');
      showToast(err.message || 'Product resolution failed', 'error');
    } finally {
      setResolvingProduct(false);
    }
  };

  // Handle Product Search (by URL, keyword, or product ID)
  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = searchQuery.trim();
    if (!query) {
      setProductError('Please enter a product name, ID, or Meesho link to search');
      return;
    }

    setIsSearching(true);
    setProductError(null);
    setSearchResults([]);

    try {
      // 1. If it's a URL or direct numeric ID, check if exact resolution
      if (query.startsWith('http://') || query.startsWith('https://') || /^\d{6,12}$/.test(query)) {
        await handleSelectProduct(query);
        return;
      }

      // 2. Keyword or general search
      const res = await CheckoutApi.searchProducts(query);
      if (res.is_exact && res.catalogs && res.catalogs.length === 1) {
        // Exact single match -> directly target this product
        await handleSelectProduct(res.catalogs[0].product_id);
      } else if (res.catalogs && res.catalogs.length > 0) {
        setSearchResults(res.catalogs);
        showToast(`Found ${res.catalogs.length} matching products. Please select one below.`, 'info');
      } else {
        setProductError('No products found matching your search. Please check the spelling or paste a direct Meesho link.');
      }
    } catch (err: any) {
      setProductError(err.message || 'Search failed');
      showToast(err.message || 'Search failed', 'error');
    } finally {
      setIsSearching(false);
    }
  };

  // Handle Variant Selection
  const handleSelectVariant = async (variant: ProductVariation) => {
    if (!variant.in_stock) return;
    setSelectedVariant(variant);
    if (product) {
      await isolateTargetProductInCart(product, variant, quantity);
      refreshQuote(selectedAddress?.id || null);
    }
  };

  // Handle Quantity Change
  const handleUpdateQuantity = async (newQty: number) => {
    if (newQty < 1 || !product || !selectedVariant) return;
    setQuantity(newQty);
    await isolateTargetProductInCart(product, selectedVariant, newQty);
    refreshQuote(selectedAddress?.id || null);
  };

  // Handle Address Selection from AddressManager
  const handleSelectAddress = (addr: DeliveryAddress) => {
    setSelectedAddress(addr);
    setAddressError(null);
    if (addr.is_upstream_registered && addr.id > 0) {
      refreshQuote(addr.id);
    } else {
      refreshQuote(null);
    }
  };

  // Auto-Add explicitly selected product to 0-order accounts only (Strict: No Checkout)
  const handleRunAutoAddToCart = async () => {
    if (!product || !selectedVariant) {
      showToast('Please select a product and size variant first', 'error');
      return;
    }
    if (ordersVerificationError) {
      showToast(`Cannot auto-add: order history verification required (${ordersVerificationError})`, 'error');
      return;
    }

    setIsAutoAddingCart(true);
    setAutoAddCartError(null);
    setAutoAddCartResult(null);

    try {
      const res = await CheckoutApi.autoAddProductToCart({
        productId: product.product_id,
        supplierId: product.supplier_id,
        variationId: selectedVariant.variation_id,
        variationName: selectedVariant.name,
        quantity,
      });

      setAutoAddCartResult(res);
      showToast(
        `Auto-add finished: ${res.added} added, ${res.skipped_has_orders} skipped (order exists), ${res.skipped_unverified} unverified, ${res.failed} failed`,
        'success'
      );
      // STRICT RULES 4 & 5:
      // Stops after cart addition. NEVER auto-checkout, place orders, or initiate payment!
    } catch (err: any) {
      const msg = err.message || 'Failed to auto-add product to cart';
      setAutoAddCartError(msg);
      showToast(msg, 'error');
    } finally {
      setIsAutoAddingCart(false);
    }
  };

  // Pre-flight Cart Isolation & Checkout Scope Verification
  const validateScopeAndIsolateCart = async (): Promise<boolean> => {
    if (!product || !selectedVariant) {
      showToast('Please select a product and size variant to checkout', 'error');
      return false;
    }
    if (!selectedVariant.in_stock) {
      showToast('Selected variant is out of stock. Please select an available variant.', 'error');
      return false;
    }
    if (!selectedAddress || !selectedAddress.id || selectedAddress.id <= 0 || !selectedAddress.is_upstream_registered) {
      showToast('Please select a verified delivery address first', 'error');
      setAddressError('Please select a delivery address registered on Meesho to proceed with checkout.');
      return false;
    }

    setIsCartIsolating(true);
    try {
      const isolateRes = await CheckoutApi.isolateCart({
        productId: product.product_id,
        supplierId: product.supplier_id,
        variationId: selectedVariant.variation_id,
        variationName: selectedVariant.name,
        quantity,
      });

      if (!isolateRes || !isolateRes.is_isolated) {
        throw new Error('Cart isolation failed. Unexpected products were detected in remote cart.');
      }

      // Verify remote cart contains strictly this product
      const cartStatus = await CheckoutApi.getCart().catch(() => null);
      if (cartStatus && cartStatus.items) {
        const unexpected = cartStatus.items.filter((it: any) => Number(it.product_id) !== product.product_id);
        if (unexpected.length > 0) {
          throw new Error(`Cart contains ${unexpected.length} unrelated item(s). Direct checkout stopped to prevent ordering wrong products.`);
        }
      }

      return true;
    } catch (err: any) {
      setCartIsolationError(err.message || 'Cart validation failed');
      showToast(err.message || 'Cart isolation error', 'error');
      return false;
    } finally {
      setIsCartIsolating(false);
    }
  };

  // Persist confirmed order to Supabase and immediately filter out the account
  const persistConfirmedOrder = async (
    orderNum: string,
    amount: number,
    mode: 'cod' | 'online' | 'free_mode',
    checkoutRef?: string,
    internalStatus?: InternalCheckoutStatus
  ) => {
    const currentAccount = eligibleAccounts.find(a => a.id === selectedAccountId);
    const targetAccountId = currentAccount?.supabase_id || String(selectedAccountId || 'default_account');
    const isFree = mode === 'free_mode';

    // Truthful payment status for merchant system:
    // Marked as 'paid' ONLY when legitimate real payment is confirmed.
    // Free mode uses 'pending' (or test mode), never fabricated as 'paid'.
    const merchantPaymentStatus: OrderPaymentStatus = isFree ? 'pending' : (mode === 'cod' ? 'cod' : 'paid');
    const internalSt: InternalCheckoutStatus = internalStatus || (isFree ? 'FREE_MODE_COMPLETED' : 'PAYMENT_CONFIRMED');

    const noteText = isFree
      ? `[FREE_MODE_COMPLETED] Checkout Ref: ${checkoutRef || 'N/A'} · Mode: Authorized Free Payment Mode (Test Mode) · Merchant Payment: Pending (Unpaid test order) · Delivery to ${selectedAddress?.city}, ${selectedAddress?.pin}`
      : `[${internalSt}] Checkout Ref: ${checkoutRef || 'N/A'} · Mode: ${mode === 'cod' ? 'Cash on Delivery' : 'Google Pay / UPI'} · Delivery to ${selectedAddress?.city}, ${selectedAddress?.pin}`;

    try {
      await StorageService.createOrder({
        account_id: targetAccountId,
        account_phone: selectedAddress?.mobile,
        external_order_id: orderNum,
        product_name: product?.name || 'Meesho Product',
        quantity,
        order_amount: amount,
        payment_status: merchantPaymentStatus,
        delivery_status: 'placed',
        cancellation_status: 'none',
        return_status: 'none',
        refund_status: 'none',
        data_source: 'verified_api',
        order_date: new Date().toISOString(),
        notes: noteText,
      });
      showToast(`Order #${orderNum} saved to Supabase (${internalSt})`, 'success');

      // Feature 4: Automatically tag the account as 'used_order_placed' and set monitoring_status = 'has_orders'
      if (targetAccountId && targetAccountId !== 'default_account') {
        const existingTags = currentAccount?.tags || [];
        const updatedTags = existingTags.includes('used_order_placed')
          ? existingTags
          : [...existingTags, 'used_order_placed'];
        await StorageService.updateAccount(targetAccountId, {
          tags: updatedTags,
          monitoring_status: 'has_orders',
        }).catch(err => console.warn('Failed to tag account as used_order_placed:', err));
      }
    } catch (err: any) {
      console.warn('Failed to persist order to Supabase:', err);
    }

    const newOrderRecord: VerifiedOrderRecord = {
      id: `ord_${Date.now()}`,
      account_id: targetAccountId,
      external_order_id: orderNum,
      delivery_status: 'placed',
      payment_status: merchantPaymentStatus,
    };

    const updatedOrders = [newOrderRecord, ...orders];
    setOrders(updatedOrders);

    const recheckResult = filterAccountsWithoutConfirmedOrders(accounts, updatedOrders);
    setEligibleAccounts(recheckResult.eligibleAccounts);

    if (recheckResult.eligibleAccounts.length > 0) {
      const nextAcc = recheckResult.eligibleAccounts[0];
      setSelectedAccountId(Number(nextAcc.id));
      handleSelectAccount(Number(nextAcc.id));
    } else {
      setSelectedAccountId(null);
      showToast('All accounts have now placed orders. No remaining 0-order accounts.', 'info');
    }
  };

  // Place Authorized Free Payment Mode Order
  const handlePlaceFreeCheckout = async () => {
    const isValid = await validateScopeAndIsolateCart();
    if (!isValid || !product || !selectedVariant || !selectedAddress || !selectedAccountId) return;

    setIsPlacingFreeOrder(true);
    const checkoutRef = checkoutSyncManager.generateCheckoutReference(selectedAccountId);
    setActiveCheckoutRef(checkoutRef);

    try {
      const currentAccount = eligibleAccounts.find(a => a.id === selectedAccountId);
      const targetAccountId = currentAccount?.supabase_id || String(selectedAccountId);
      const addressText = `${selectedAddress.name}, ${selectedAddress.address_line_1}, ${selectedAddress.city} - ${selectedAddress.pin}`;

      // Initialize attempt with status ORDER_CREATED
      const attempt = checkoutSyncManager.initCheckoutAttempt({
        accountId: selectedAccountId,
        accountPhone: selectedAddress.mobile,
        productId: product.product_id,
        productName: product.name,
        variantId: selectedVariant.variation_id,
        variantName: selectedVariant.name,
        quantity,
        amount: quote?.online_payable || product.price * quantity,
        addressId: selectedAddress.id,
        addressText,
        isFreeMode: true,
        checkoutReference: checkoutRef,
      });

      // Execute authorized Free Payment flow: ORDER_CREATED -> FREE_MODE_PENDING -> FREE_MODE_COMPLETED
      const res = await checkoutSyncManager.executeFreeCheckoutFlow(
        attempt,
        targetAccountId,
        currentAccount?.tags || []
      );

      if (res.ok) {
        // Also update local list of orders and re-filter eligible accounts
        const newOrderRecord: VerifiedOrderRecord = {
          id: `ord_${Date.now()}`,
          account_id: targetAccountId,
          external_order_id: res.order_num,
          delivery_status: 'placed',
          payment_status: 'pending',
        };
        const updatedOrders = [newOrderRecord, ...orders];
        setOrders(updatedOrders);

        const recheckResult = filterAccountsWithoutConfirmedOrders(accounts, updatedOrders);
        setEligibleAccounts(recheckResult.eligibleAccounts);

        if (recheckResult.eligibleAccounts.length > 0) {
          const nextAcc = recheckResult.eligibleAccounts[0];
          setSelectedAccountId(Number(nextAcc.id));
          handleSelectAccount(Number(nextAcc.id));
        } else {
          setSelectedAccountId(null);
        }

        setConfirmedOrder({
          orderNum: res.order_num,
          amount: res.amount,
          paymentMode: 'Authorized Free Mode (Test Mode)',
          productName: product.name,
          variantName: selectedVariant.name,
          quantity,
          address: addressText,
          checkoutReference: checkoutRef,
          internalStatus: 'FREE_MODE_COMPLETED',
          merchantPaymentStatus: 'pending',
        });

        showToast(`Order #${res.order_num} successfully created in Free Payment Mode!`, 'success');
      } else {
        throw new Error(res.error || res.message || 'Free mode checkout failed');
      }
    } catch (err: any) {
      showToast(err?.message || 'Free mode checkout failed', 'error');
    } finally {
      setIsPlacingFreeOrder(false);
    }
  };

  // Place COD Order
  const handlePlaceCod = async () => {
    const isValid = await validateScopeAndIsolateCart();
    if (!isValid || !product || !selectedVariant || !selectedAddress || !selectedAccountId) return;

    setIsPlacingCod(true);
    const checkoutRef = checkoutSyncManager.generateCheckoutReference(selectedAccountId);
    setActiveCheckoutRef(checkoutRef);

    try {
      checkoutSyncManager.initCheckoutAttempt({
        accountId: selectedAccountId,
        accountPhone: selectedAddress.mobile,
        productId: product.product_id,
        productName: product.name,
        variantId: selectedVariant.variation_id,
        variantName: selectedVariant.name,
        quantity,
        amount: quote?.cod_payable || product.price * quantity,
        addressId: selectedAddress.id,
        addressText: `${selectedAddress.name}, ${selectedAddress.address_line_1}, ${selectedAddress.city} - ${selectedAddress.pin}`,
        isFreeMode: false,
        checkoutReference: checkoutRef,
      });

      const res = await CheckoutApi.placeCod(selectedAddress.id);
      if (res && res.ok && res.order_num) {
        const orderTotal = res.total || quote?.cod_payable || product.price;
        checkoutSyncManager.updateStatus(checkoutRef, 'PAYMENT_CONFIRMED', {
          merchant_order_id: res.order_num,
          merchant_payment_status: 'cod',
        });

        await persistConfirmedOrder(res.order_num, orderTotal, 'cod', checkoutRef, 'PAYMENT_CONFIRMED');

        setConfirmedOrder({
          orderNum: res.order_num,
          amount: orderTotal,
          paymentMode: 'Cash on Delivery (COD)',
          productName: product.name,
          variantName: selectedVariant.name,
          quantity,
          address: `${selectedAddress.name}, ${selectedAddress.address_line_1}, ${selectedAddress.city} - ${selectedAddress.pin}`,
          checkoutReference: checkoutRef,
          internalStatus: 'PAYMENT_CONFIRMED',
          merchantPaymentStatus: 'cod',
        });
        showToast(`Cash on Delivery order successfully placed for ${product.name}!`, 'success');
      } else {
        throw new Error(res?.message || 'Could not place COD order');
      }
    } catch (err: any) {
      const msg = err.message || 'COD order failed';
      if (msg.includes('Address not found') || msg.includes('unavailable or has expired')) {
        setAddressError('Your selected delivery address is unavailable or has expired. Please select another verified address.');
        setSelectedAddress(null);
      }
      showToast(msg, 'error');
    } finally {
      setIsPlacingCod(false);
    }
  };

  // Place Online / GPay Order
  const handleStartOnlinePayment = async () => {
    const isValid = await validateScopeAndIsolateCart();
    if (!isValid || !product || !selectedVariant || !selectedAddress || !selectedAccountId) return;

    const checkoutRef = checkoutSyncManager.generateCheckoutReference(selectedAccountId);
    setActiveCheckoutRef(checkoutRef);

    checkoutSyncManager.initCheckoutAttempt({
      accountId: selectedAccountId,
      accountPhone: selectedAddress.mobile,
      productId: product.product_id,
      productName: product.name,
      variantId: selectedVariant.variation_id,
      variantName: selectedVariant.name,
      quantity,
      amount: quote?.online_payable || product.price * quantity,
      addressId: selectedAddress.id,
      addressText: `${selectedAddress.name}, ${selectedAddress.address_line_1}, ${selectedAddress.city} - ${selectedAddress.pin}`,
      isFreeMode: false,
      checkoutReference: checkoutRef,
    });

    checkoutSyncManager.updateStatus(checkoutRef, 'PAYMENT_PENDING');
    setIsGPayModalOpen(true);
  };

  // Callback when GPay modal confirms order
  const handleOnlineOrderConfirmed = async (
    orderNum: string,
    amount: number,
    confirmRes: any,
    checkoutRef: string
  ) => {
    // Check if stale
    if (checkoutSyncManager.isStaleResponse(checkoutRef)) {
      console.warn('Ignoring stale online order confirmation for', checkoutRef);
      return;
    }

    setIsGPayModalOpen(false);
    checkoutSyncManager.updateStatus(checkoutRef, 'PAYMENT_CONFIRMED', {
      merchant_order_id: orderNum,
      merchant_payment_status: 'paid',
    });

    await persistConfirmedOrder(orderNum, amount, 'online', checkoutRef, 'PAYMENT_CONFIRMED');

    setConfirmedOrder({
      orderNum,
      amount,
      paymentMode: 'Google Pay / UPI (Prepaid)',
      productName: product?.name || 'Meesho Product',
      variantName: selectedVariant?.name || 'Standard',
      quantity,
      address: `${selectedAddress?.name}, ${selectedAddress?.address_line_1}, ${selectedAddress?.city} - ${selectedAddress?.pin}`,
      checkoutReference: checkoutRef,
      internalStatus: 'PAYMENT_CONFIRMED',
      merchantPaymentStatus: 'paid',
    });
    showToast(`Order #${orderNum} placed and verified!`, 'success');
  };

  // Callback when payment is charged but merchant confirmation needs reconciliation
  const handleReconciliationRequired = async (
    orderNum: string,
    amount: number,
    reason: string,
    checkoutRef: string
  ) => {
    if (checkoutSyncManager.isStaleResponse(checkoutRef)) {
      console.warn('Ignoring stale reconciliation event for', checkoutRef);
      return;
    }

    try {
      checkoutSyncManager.updateStatus(checkoutRef, 'RECONCILIATION_REQUIRED', {
        merchant_order_id: orderNum,
        merchant_payment_status: 'pending',
        reconciliation_reason: reason,
      });

      const currentAccount = eligibleAccounts.find(a => a.id === selectedAccountId);
      const targetAccountId = currentAccount?.supabase_id || String(selectedAccountId || 'default_account');

      await StorageService.createOrder({
        account_id: targetAccountId,
        account_phone: selectedAddress?.mobile,
        external_order_id: orderNum,
        product_name: product?.name || 'Meesho Product',
        quantity,
        order_amount: amount,
        payment_status: 'pending',
        delivery_status: 'placed',
        cancellation_status: 'none',
        return_status: 'none',
        refund_status: 'none',
        data_source: 'verified_api',
        order_date: new Date().toISOString(),
        notes: `[RECONCILIATION_REQUIRED] Checkout Ref: ${checkoutRef} · Gateway charged, but merchant confirmation requires review. Reason: ${reason}`,
      });
    } catch (e) {
      console.warn('Failed to record reconciliation order:', e);
    }

    showToast(`Order #${orderNum} marked as RECONCILIATION_REQUIRED: ${reason}`, 'warning');
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-pink-500/10 text-pink-400 border border-pink-500/20 uppercase tracking-wider">
              Direct Checkout
            </span>
            <span className="text-slate-400 text-xs">• Native Payment Gateway</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            Meesho Direct Order & Checkout
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Search or paste any product, isolate checkout strictly to the selected item, and authorize orders with clean status tracking.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Free Payment Mode Toggle */}
          <button
            type="button"
            onClick={() => {
              const next = !isFreePaymentMode;
              PaymentConfig.setFreePaymentMode(next);
              setIsFreePaymentMode(next);
              showToast(
                next
                  ? 'Free Payment Mode Enabled: Checkout operates without real payments or QR codes'
                  : 'Normal Payment Mode Enabled: Real UPI/COD payment workflow restored',
                next ? 'success' : 'info'
              );
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer shadow-sm ${
              isFreePaymentMode
                ? 'bg-emerald-950/90 border-emerald-500/80 text-emerald-300 hover:bg-emerald-900 shadow-emerald-950/50 ring-1 ring-emerald-500/50'
                : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
            title="Toggle between Authorized Free Mode and Normal Real Payment Mode"
          >
            <Zap className={`w-3.5 h-3.5 ${isFreePaymentMode ? 'text-emerald-400 fill-emerald-400/30 animate-pulse' : 'text-slate-400'}`} />
            <span>Free Payment Mode: {isFreePaymentMode ? 'ON' : 'OFF'}</span>
          </button>

          {/* Account Selector (Filtered for 0-order accounts) */}
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg p-1.5 shadow-sm">
            <User className="w-4 h-4 text-pink-400 ml-1.5" />
            <span className="text-xs text-slate-400">
              Account {verifyingEligibility ? '(verifying...)' : `(${eligibleAccounts.length} 0-order)`}:
            </span>
            <select
              value={selectedAccountId || ''}
              disabled={eligibleAccounts.length === 0 || verifyingEligibility || Boolean(ordersVerificationError)}
              onChange={e => handleSelectAccount(Number(e.target.value))}
              className="bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded px-2.5 py-1 focus:ring-1 focus:ring-pink-500 focus:outline-none disabled:opacity-50"
            >
              {eligibleAccounts.length === 0 ? (
                <option value="">No 0-order accounts available</option>
              ) : (
                eligibleAccounts.map(acc => (
                  <option key={acc.id} value={acc.id}>
                    +91 {acc.mobile} (ID: {acc.id})
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              onClick={() => loadInitialData()}
              disabled={verifyingEligibility}
              className="p-1 text-slate-400 hover:text-pink-400 hover:bg-slate-800 rounded transition-colors cursor-pointer"
              title="Refresh accounts and re-verify order history"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${verifyingEligibility ? 'animate-spin text-pink-400' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (eligibleAccounts.length === 0) {
                  showToast('No eligible accounts available to export', 'error');
                  return;
                }
                exportDirectCheckoutAccountsJson(eligibleAccounts);
                showToast(`Exported ${eligibleAccounts.length} Direct Checkout Accounts JSON`, 'success');
              }}
              disabled={eligibleAccounts.length === 0 || verifyingEligibility}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-pink-950/80 hover:bg-pink-900 border border-pink-700/60 hover:border-pink-500 text-pink-200 hover:text-white rounded text-xs font-semibold transition-all disabled:opacity-40 cursor-pointer ml-1 shadow-sm"
              title="Export all eligible zero-order accounts as raw JSON array"
            >
              <Download className="w-3.5 h-3.5 text-pink-400" />
              <span className="hidden sm:inline">Export JSON</span>
            </button>
          </div>
        </div>
      </div>

      {/* Free Payment Mode Educational Notice Banner */}
      {isFreePaymentMode && (
        <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-950/60 via-slate-900 to-slate-950 border border-emerald-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-md animate-fadeIn">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30 shrink-0">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <strong className="text-emerald-300 font-bold text-sm">
                  Authorized Free Payment Mode Active
                </strong>
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-semibold uppercase">
                  No Money Requested • Zero QR Codes
                </span>
              </div>
              <p className="text-slate-300 text-xs mt-0.5">
                Direct Checkout operates in an authorized free/test mode. No real money will be charged, no QR code will be generated, and your order will be assigned an explicit internal status (<strong className="text-emerald-400">FREE_MODE_COMPLETED</strong>) while keeping merchant payment records pending and untampered.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              PaymentConfig.setFreePaymentMode(false);
              setIsFreePaymentMode(false);
              showToast('Switched to Normal Payment Mode (Real UPI / COD)', 'info');
            }}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 shrink-0 cursor-pointer transition-colors"
          >
            Switch to Real Payment
          </button>
        </div>
      )}

      {/* Account Eligibility Verification Warning Banner */}
      {ordersVerificationError && (
        <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-600/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-200 shadow-md">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <strong className="block text-amber-300 font-semibold text-sm">
                Account Order History Verification Warning
              </strong>
              <span>
                Could not verify order history due to a database/network error: {ordersVerificationError}. Direct Checkout is temporarily locked to avoid placing orders on non-eligible accounts.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => loadInitialData()}
            className="px-3.5 py-1.5 bg-amber-700 hover:bg-amber-600 text-white rounded-lg font-semibold text-xs shrink-0 cursor-pointer transition-colors"
          >
            Retry Verification
          </button>
        </div>
      )}

      {/* No Zero-Order Accounts Available Banner */}
      {!ordersVerificationError && !verifyingEligibility && eligibleAccounts.length === 0 && (
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-3 text-xs text-slate-300">
          <AlertTriangle className="w-5 h-5 text-pink-400 shrink-0" />
          <div>
            <strong className="block text-white font-semibold text-sm">
              No Eligible Accounts Available
            </strong>
            <span>
              All {accounts.length} linked accounts have either already placed confirmed orders on Meesho or are marked as Sold. Import fresh active accounts to proceed with direct checkout.
            </span>
          </div>
        </div>
      )}

      {/* Confirmed Order Banner */}
      {confirmedOrder && (
        <div className="p-6 rounded-2xl bg-gradient-to-r from-emerald-950/60 via-slate-900 to-slate-950 border border-emerald-500/40 shadow-xl relative overflow-hidden animate-slideDown">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-600/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30 shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                  <span>Order Successfully Placed</span>
                  {confirmedOrder.internalStatus && (
                    <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono">
                      {confirmedOrder.internalStatus}
                    </span>
                  )}
                </span>
                <button
                  onClick={() => setActiveTab('orders')}
                  className="inline-flex items-center gap-1 text-xs text-pink-400 hover:text-pink-300 font-medium underline"
                >
                  View in Orders History <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <h3 className="text-xl font-extrabold text-white mt-1 flex items-center gap-2.5">
                <span>Order #{confirmedOrder.orderNum}</span>
                {confirmedOrder.checkoutReference && (
                  <span className="text-xs font-mono text-slate-400 font-normal">
                    (Ref: {confirmedOrder.checkoutReference})
                  </span>
                )}
              </h3>
              <p className="text-sm text-slate-200 font-medium mt-1">{confirmedOrder.productName}</p>
              <div className="flex flex-wrap gap-4 text-xs text-slate-400 mt-3 pt-3 border-t border-slate-800/80">
                <span>Variant: <strong className="text-white">{confirmedOrder.variantName || 'Selected Variant'}</strong></span>
                <span>•</span>
                <span>Qty: <strong className="text-white font-mono">{confirmedOrder.quantity}</strong></span>
                <span>•</span>
                <span>Amount: <strong className="text-white font-mono">₹{confirmedOrder.amount}</strong></span>
                <span>•</span>
                <span>Mode: <strong className="text-white">{confirmedOrder.paymentMode}</strong></span>
                {confirmedOrder.merchantPaymentStatus && (
                  <>
                    <span>•</span>
                    <span>Merchant Payment: <strong className={confirmedOrder.merchantPaymentStatus === 'paid' ? 'text-emerald-400' : 'text-amber-400 font-mono'}>{confirmedOrder.merchantPaymentStatus.toUpperCase()}</strong></span>
                  </>
                )}
                <span>•</span>
                <span>Ship to: <strong className="text-slate-200">{confirmedOrder.address}</strong></span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 1: Product Search & URL Input Form */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm backdrop-blur-sm">
        <form onSubmit={handleSearch} className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
              Search or Paste Meesho Product
            </label>
            <span className="text-[11px] text-slate-500 hidden sm:inline">
              Enter Product Name (e.g. &quot;Kurti&quot;), Product ID (e.g. 1053270803), or Meesho Link
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Search className="w-4 h-4 text-pink-400" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by keyword (e.g. Kurti), product ID, or Meesho URL..."
                className="w-full pl-9 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-100 placeholder-slate-500 text-sm focus:border-pink-500 focus:ring-1 focus:ring-pink-500 focus:outline-none transition-all"
              />
            </div>
            <button
              type="submit"
              disabled={isSearching || resolvingProduct}
              className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-pink-600 hover:bg-pink-500 text-white font-semibold text-sm transition-all shadow-md shadow-pink-900/20 disabled:opacity-50 cursor-pointer shrink-0"
            >
              {isSearching || resolvingProduct ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  Finding Product...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" /> Find Product
                </>
              )}
            </button>
          </div>
        </form>

        {productError && (
          <div className="mt-3 p-3 bg-rose-950/40 border border-rose-800/60 rounded-lg text-xs text-rose-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{productError}</span>
          </div>
        )}
      </div>

      {/* Search Results Grid (Requires explicit user selection) */}
      {searchResults.length > 0 && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-slate-200">
                Matching Search Results ({searchResults.length})
              </span>
              <span className="text-xs text-pink-400 bg-pink-500/10 px-2 py-0.5 rounded border border-pink-500/20">
                Select 1 Product for Checkout
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSearchResults([])}
              className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" /> Dismiss Results
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-[460px] overflow-y-auto pr-1">
            {searchResults.map(item => {
              const isSelected = product?.product_id === item.product_id;
              return (
                <div
                  key={item.product_id}
                  className={`flex flex-col justify-between rounded-xl border p-3 transition-all ${
                    isSelected
                      ? 'bg-pink-950/30 border-pink-500 shadow-md ring-1 ring-pink-500/40'
                      : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="aspect-square rounded-lg bg-slate-900 overflow-hidden mb-2.5 relative">
                      {item.image ? (
                        <img
                          src={item.image}
                          alt={item.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-slate-500">
                          No image
                        </div>
                      )}
                      {item.discount_text && (
                        <span className="absolute top-1.5 left-1.5 bg-pink-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow">
                          {item.discount_text}
                        </span>
                      )}
                    </div>

                    <h4 className="text-xs font-semibold text-slate-200 line-clamp-2 leading-snug" title={item.name}>
                      {item.name}
                    </h4>

                    <div className="flex items-baseline gap-2 mt-2">
                      <span className="text-sm font-bold font-mono text-white">₹{item.price}</span>
                      {item.original_price && item.original_price > item.price && (
                        <span className="text-[11px] text-slate-500 line-through font-mono">
                          ₹{item.original_price}
                        </span>
                      )}
                    </div>

                    {item.sizes && item.sizes.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {item.sizes.slice(0, 4).map((s, idx) => (
                          <span
                            key={idx}
                            className="text-[10px] bg-slate-900 text-slate-400 border border-slate-800 px-1.5 py-0.5 rounded"
                          >
                            {s.name}
                          </span>
                        ))}
                        {item.sizes.length > 4 && (
                          <span className="text-[10px] text-slate-500">+{item.sizes.length - 4}</span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-slate-800/80">
                    <button
                      type="button"
                      onClick={() => handleSelectProduct(item.product_id)}
                      disabled={resolvingProduct}
                      className={`w-full py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                        isSelected
                          ? 'bg-pink-600 text-white shadow-sm'
                          : 'bg-slate-800 hover:bg-pink-600 hover:text-white text-slate-200'
                      }`}
                    >
                      {isSelected ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" /> Selected Target
                        </>
                      ) : (
                        <>
                          Select for Checkout <ChevronRight className="w-3 h-3" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Isolated Checkout Target Summary Banner */}
      {product && (
        <div className="p-4 rounded-xl bg-gradient-to-r from-pink-950/40 via-slate-900 to-slate-950 border border-pink-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-pink-500/20 text-pink-400 flex items-center justify-center shrink-0 border border-pink-500/30">
              <PackageCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase font-bold tracking-wider text-pink-400 bg-pink-500/10 px-1.5 py-0.5 rounded border border-pink-500/20">
                  Strict Checkout Target (1 Product)
                </span>
                <span className="text-slate-400 text-xs">
                  Product ID: <strong className="text-white font-mono">{product.product_id}</strong>
                </span>
              </div>
              <div className="text-slate-200 font-medium text-sm mt-0.5">
                {product.name}
              </div>
              <div className="text-slate-400 text-xs mt-0.5">
                Variant: <strong className="text-white">{selectedVariant?.name || 'Standard'}</strong> • Qty: <strong className="text-white font-mono">{quantity}</strong> • Cart State:{' '}
                <strong className={isCartIsolating ? 'text-amber-400' : 'text-emerald-400'}>
                  {isCartIsolating ? 'Isolating remote cart...' : 'Isolated (Single Item in Cart)'}
                </strong>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => {
                setAutoAddCartResult(null);
                setAutoAddCartError(null);
                setAutoAddCartModalOpen(true);
              }}
              disabled={isAutoAddingCart || Boolean(ordersVerificationError)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-500 text-white text-xs font-semibold cursor-pointer transition-all shadow-md shadow-pink-900/30 disabled:opacity-50"
              title="Auto-add this product to cart for 0-order accounts only (No Checkout)"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>Auto-Add to Cart (0-Order Accounts)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setProduct(null);
                setSelectedVariant(null);
                setQuote(null);
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium cursor-pointer transition-colors"
            >
              Change Target Product
            </button>
          </div>
        </div>
      )}

      {/* Cart Isolation Error Alert */}
      {cartIsolationError && (
        <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-xl text-xs text-rose-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{cartIsolationError}</span>
        </div>
      )}

      {/* Main Grid: Product Details & Checkout Options */}
      {product && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Product Showcase & Variations */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-sm backdrop-blur-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Images */}
                <div className="space-y-3">
                  <div className="aspect-square rounded-xl bg-slate-950 border border-slate-800/80 overflow-hidden relative">
                    {selectedImage ? (
                      <img
                        src={selectedImage}
                        alt={product.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-400">
                        No image available
                      </div>
                    )}
                    {product.mall_verified && (
                      <span className="absolute top-2 left-2 bg-pink-600 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow">
                        MALL VERIFIED
                      </span>
                    )}
                  </div>

                  {product.images && product.images.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {product.images.map((img, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setSelectedImage(img)}
                          className={`w-14 h-14 rounded-lg overflow-hidden border-2 shrink-0 cursor-pointer transition-all ${
                            selectedImage === img
                              ? 'border-pink-500 scale-105'
                              : 'border-slate-800 hover:border-slate-700 opacity-70'
                          }`}
                        >
                          <img src={img} alt="" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Product Meta & Variant Selection */}
                <div className="flex flex-col justify-between">
                  <div className="space-y-3">
                    <div>
                      <span className="text-xs text-pink-400 font-semibold tracking-wide uppercase">
                        {product.supplier_name || 'Meesho Supplier'}
                      </span>
                      <h2 className="text-lg font-bold text-white leading-snug mt-0.5">
                        {product.name}
                      </h2>
                    </div>

                    <div className="flex items-baseline gap-3">
                      <span className="text-2xl font-black text-white font-mono">
                        ₹{product.price}
                      </span>
                      {product.mrp && product.mrp > product.price && (
                        <>
                          <span className="text-sm text-slate-400 line-through font-mono">
                            ₹{product.mrp}
                          </span>
                          <span className="text-xs font-bold text-emerald-400">
                            {Math.round(((product.mrp - product.price) / product.mrp) * 100)}% OFF
                          </span>
                        </>
                      )}
                    </div>

                    {/* Stock Status Badge */}
                    <div className="flex items-center gap-2">
                      {product.in_stock ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/40">
                          <CheckCircle2 className="w-3.5 h-3.5" /> In Stock
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-rose-400 font-medium bg-rose-950/40 px-2 py-0.5 rounded border border-rose-800/40">
                          <AlertTriangle className="w-3.5 h-3.5" /> Out of Stock
                        </span>
                      )}
                      {product.supplier_rating && (
                        <span className="text-xs text-amber-400 font-semibold">
                          ★ {product.supplier_rating}
                        </span>
                      )}
                    </div>

                    {/* Sizes / Variations */}
                    {product.sizes && product.sizes.length > 0 && (
                      <div className="pt-2">
                        <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                          Select Size / Variant
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {product.sizes.map(size => {
                            const isSelected = selectedVariant?.variation_id === size.variation_id;
                            return (
                              <button
                                key={size.variation_id}
                                type="button"
                                disabled={!size.in_stock}
                                onClick={() => handleSelectVariant(size)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                                  isSelected
                                    ? 'bg-pink-600 border-pink-500 text-white shadow-md'
                                    : size.in_stock
                                    ? 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                                    : 'bg-slate-950/50 border-slate-800/40 text-slate-600 line-through cursor-not-allowed'
                                }`}
                              >
                                {size.name}
                                {!size.in_stock && ' (Out of stock)'}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Quantity */}
                    <div className="pt-2">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                        Quantity
                      </label>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => handleUpdateQuantity(Math.max(1, quantity - 1))}
                          className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold flex items-center justify-center cursor-pointer"
                        >
                          -
                        </button>
                        <span className="text-base font-bold text-white font-mono px-2">
                          {quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUpdateQuantity(quantity + 1)}
                          className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold flex items-center justify-center cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Highlights / Features */}
                  {product.highlights && product.highlights.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-slate-800/80">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {product.highlights.slice(0, 4).map((h, i) => (
                          <div key={i} className="text-slate-400">
                            <span className="text-slate-400">{h.name}:</span>{' '}
                            <strong className="text-slate-200">{h.value}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Step 2: Address Manager with Predefined and Registered Addresses */}
            <AddressManager
              accountId={selectedAccountId}
              addresses={addresses}
              selectedAddress={selectedAddress}
              onSelectAddress={handleSelectAddress}
              onAddressListChange={reloadAddresses}
              addressError={addressError}
              onClearAddressError={() => setAddressError(null)}
              isLoading={quoteLoading}
            />
          </div>

          {/* Right Column: Pricing & Place Order Button */}
          <div className="space-y-6">
            <PriceCard
              quote={quote}
              loading={quoteLoading}
              error={quoteError}
              paymentMethod={paymentMethod}
              onSelectPaymentMethod={setPaymentMethod}
              onRefreshQuote={() => refreshQuote(selectedAddress?.id || null)}
              selectedAddressId={selectedAddress?.id && selectedAddress.is_upstream_registered ? selectedAddress.id : null}
              preliminaryPrice={product.price * quantity}
            />

            {/* Final Place Order Action */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-lg backdrop-blur-sm space-y-3">
              {isFreePaymentMode ? (
                <button
                  type="button"
                  onClick={handlePlaceFreeCheckout}
                  disabled={
                    !selectedAddress ||
                    !selectedAddress.id ||
                    selectedAddress.id <= 0 ||
                    !selectedAddress.is_upstream_registered ||
                    !selectedVariant?.in_stock ||
                    quoteLoading ||
                    isCartIsolating ||
                    isPlacingFreeOrder ||
                    !selectedAccountId ||
                    eligibleAccounts.length === 0 ||
                    Boolean(ordersVerificationError)
                  }
                  className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm tracking-wide shadow-lg shadow-emerald-950/40 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPlacingFreeOrder ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      Creating Free Mode Order...
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4 text-emerald-200" /> Direct Checkout (Authorized Free Mode)
                    </>
                  )}
                </button>
              ) : paymentMethod === 'online' ? (
                <button
                  type="button"
                  onClick={handleStartOnlinePayment}
                  disabled={
                    !selectedAddress ||
                    !selectedAddress.id ||
                    selectedAddress.id <= 0 ||
                    !selectedAddress.is_upstream_registered ||
                    !selectedVariant?.in_stock ||
                    quoteLoading ||
                    isCartIsolating ||
                    !selectedAccountId ||
                    eligibleAccounts.length === 0 ||
                    Boolean(ordersVerificationError)
                  }
                  className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-pink-600 via-rose-600 to-pink-700 hover:from-pink-500 hover:to-pink-600 text-white font-bold text-sm tracking-wide shadow-lg shadow-pink-900/40 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Sparkles className="w-4 h-4" /> Pay with Google Pay (UPI)
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handlePlaceCod}
                  disabled={
                    !selectedAddress ||
                    !selectedAddress.id ||
                    selectedAddress.id <= 0 ||
                    !selectedAddress.is_upstream_registered ||
                    !selectedVariant?.in_stock ||
                    isPlacingCod ||
                    isCartIsolating ||
                    quoteLoading ||
                    !selectedAccountId ||
                    eligibleAccounts.length === 0 ||
                    Boolean(ordersVerificationError)
                  }
                  className="w-full py-3.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm tracking-wide shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPlacingCod ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      Placing COD Order...
                    </>
                  ) : (
                    <>
                      <Truck className="w-4 h-4 text-pink-400" /> Place Cash on Delivery Order
                    </>
                  )}
                </button>
              )}

              <p className="text-[11px] text-center text-slate-400 leading-tight">
                {isFreePaymentMode ? (
                  <span className="text-emerald-400 font-medium">
                    ⚡ Authorized Free Mode Active: No money requested or QR generated. Status: <strong className="font-mono">FREE_MODE_COMPLETED</strong>.
                  </span>
                ) : (
                  <>
                    Order will only contain: <strong className="text-white">{product.name} ({selectedVariant?.name || 'Standard'}) × {quantity}</strong>.
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* GPay & UPI Modal */}
      {selectedAddress && quote && (
        <GPayModal
          isOpen={isGPayModalOpen}
          onClose={() => setIsGPayModalOpen(false)}
          address={selectedAddress}
          quote={quote}
          checkoutReference={activeCheckoutRef}
          onOrderConfirmed={handleOnlineOrderConfirmed}
          onReconciliationRequired={handleReconciliationRequired}
        />
      )}

      {/* Auto-Add Product to Cart Modal (0-Order Accounts Only) */}
      {autoAddCartModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl relative space-y-5 animate-scaleUp">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-slate-800/80 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-pink-500/10 border border-pink-500/20 text-pink-400 flex items-center justify-center">
                  <ShoppingCart className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    Auto-Add Product to Cart
                  </h3>
                  <p className="text-xs text-slate-400">
                    Accounts that have not placed their first order only
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAutoAddCartModalOpen(false)}
                disabled={isAutoAddingCart}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Target Product Summary Card */}
            {product && selectedVariant && (
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center gap-3.5">
                {selectedImage ? (
                  <img
                    src={selectedImage}
                    alt=""
                    className="w-12 h-12 rounded-lg object-cover bg-slate-900 border border-slate-800 shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 text-xs shrink-0">
                    <Package className="w-6 h-6 text-slate-600" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h4 className="text-xs font-semibold text-white line-clamp-1">
                    {product.name}
                  </h4>
                  <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-1">
                    <span>Variant: <strong className="text-pink-400">{selectedVariant.name}</strong></span>
                    <span>•</span>
                    <span>Qty: <strong className="text-white font-mono">{quantity}</strong></span>
                    <span>•</span>
                    <span>Price: <strong className="text-emerald-400 font-mono">₹{product.price}</strong></span>
                  </div>
                </div>
              </div>
            )}

            {/* Strict Policy & Safety Guarantees */}
            {!autoAddCartResult && (
              <div className="space-y-2.5 text-xs">
                <div className="p-3 rounded-lg bg-pink-950/20 border border-pink-500/20 text-pink-200 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-semibold text-pink-300">
                    <ShieldCheck className="w-4 h-4 text-pink-400 shrink-0" />
                    <span>Strict Automation Safeguards</span>
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-slate-300 text-[11px] pl-1">
                    <li><strong>Order History First:</strong> Verified before modifying each account's cart.</li>
                    <li><strong>0-Order Accounts Only:</strong> Accounts with an existing confirmed order are skipped.</li>
                    <li><strong>Unverified History Skipped:</strong> Never assumes zero orders if API/network fails.</li>
                    <li><strong>Duplicate Prevention:</strong> Accounts already containing this item are not duplicated.</li>
                    <li><strong>Ineligible Accounts Excluded:</strong> Accounts marked Sold are excluded.</li>
                    <li><strong>Never Auto-Checkout:</strong> Automation stops strictly at cart addition. No orders or payments will be placed.</li>
                  </ul>
                </div>

                {autoAddCartError && (
                  <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-lg text-rose-300 flex items-center gap-2 text-xs">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>{autoAddCartError}</span>
                  </div>
                )}
              </div>
            )}

            {/* Results Breakdown Banner */}
            {autoAddCartResult && (
              <div className="space-y-3.5">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-center">
                    <span className="text-[10px] uppercase font-bold text-emerald-400 block tracking-wider">
                      Added to Cart
                    </span>
                    <strong className="text-xl font-mono font-black text-white mt-0.5 block">
                      {autoAddCartResult.added}
                    </strong>
                  </div>

                  <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/40 text-center">
                    <span className="text-[10px] uppercase font-bold text-indigo-400 block tracking-wider">
                      Skipped (Has Order)
                    </span>
                    <strong className="text-xl font-mono font-black text-white mt-0.5 block">
                      {autoAddCartResult.skipped_has_orders}
                    </strong>
                  </div>

                  <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 text-center">
                    <span className="text-[10px] uppercase font-bold text-amber-400 block tracking-wider">
                      Skipped (Unverified)
                    </span>
                    <strong className="text-xl font-mono font-black text-white mt-0.5 block">
                      {autoAddCartResult.skipped_unverified}
                    </strong>
                  </div>

                  <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 text-center">
                    <span className="text-[10px] uppercase font-bold text-rose-400 block tracking-wider">
                      Failed
                    </span>
                    <strong className="text-xl font-mono font-black text-white mt-0.5 block">
                      {autoAddCartResult.failed}
                    </strong>
                  </div>
                </div>

                {autoAddCartResult.already_in_cart > 0 && (
                  <div className="px-3 py-2 rounded-lg bg-cyan-950/30 border border-cyan-500/30 text-xs text-cyan-300 flex items-center justify-between">
                    <span>Duplicates Prevented (Already in Cart):</span>
                    <strong className="font-mono text-cyan-200">{autoAddCartResult.already_in_cart}</strong>
                  </div>
                )}

                {/* Per-Account Details List */}
                {autoAddCartResult.details && autoAddCartResult.details.length > 0 && (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                      Account Operations Log ({autoAddCartResult.details.length})
                    </span>
                    {autoAddCartResult.details.map((d, i) => {
                      let badgeColor = 'bg-slate-800 text-slate-300 border-slate-700';
                      let statusText: string = d.status;
                      if (d.status === 'added') {
                        badgeColor = 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40';
                        statusText = 'Added';
                      } else if (d.status === 'already_in_cart') {
                        badgeColor = 'bg-cyan-950/60 text-cyan-300 border-cyan-500/40';
                        statusText = 'Already in Cart';
                      } else if (d.status === 'skipped_has_orders') {
                        badgeColor = 'bg-indigo-950/60 text-indigo-300 border-indigo-500/40';
                        statusText = 'Order Exists';
                      } else if (d.status === 'skipped_unverified') {
                        badgeColor = 'bg-amber-950/60 text-amber-300 border-amber-500/40';
                        statusText = 'Unverified';
                      } else if (d.status === 'failed') {
                        badgeColor = 'bg-rose-950/60 text-rose-300 border-rose-500/40';
                        statusText = 'Failed';
                      }

                      return (
                        <div
                          key={i}
                          className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800/80 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono text-white text-[11px]">
                              {d.mobile ? `+91 ${d.mobile}` : `ID: ${d.shop_id}`}
                            </span>
                            <span className="text-[11px] text-slate-500 truncate" title={d.message}>
                              {d.message}
                            </span>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border shrink-0 ${badgeColor}`}>
                            {statusText}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-400 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    Automation has stopped at cart addition. No orders were placed and checkout was not executed. Direct Checkout remains available for explicit manual use only.
                  </span>
                </div>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800/80">
              {!autoAddCartResult ? (
                <>
                  <button
                    type="button"
                    onClick={() => setAutoAddCartModalOpen(false)}
                    disabled={isAutoAddingCart}
                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleRunAutoAddToCart}
                    disabled={isAutoAddingCart}
                    className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-pink-600 hover:bg-pink-500 text-white text-xs font-bold transition-all shadow-md shadow-pink-900/30 cursor-pointer disabled:opacity-50"
                  >
                    {isAutoAddingCart ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                        <span>Verifying Orders & Adding...</span>
                      </>
                    ) : (
                      <>
                        <ShoppingCart className="w-3.5 h-3.5" />
                        <span>Run Auto-Add to Cart</span>
                      </>
                    )}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setAutoAddCartModalOpen(false)}
                  className="px-5 py-2 rounded-lg bg-pink-600 hover:bg-pink-500 text-white text-xs font-bold cursor-pointer transition-colors shadow-sm"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
