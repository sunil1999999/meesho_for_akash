import React, { useState, useEffect, useRef } from 'react';
import { AccountRecord } from '../../types';
import {
  TelegramWorkflowState,
  TelegramStepLog,
  TelegramWorkflowReport,
  ExtractedOrderData,
} from '../../types/telegram';
import {
  TelegramBotWorkflowRunner,
  validateSessionPayload,
  TELEGRAM_MAX_MESSAGE_LENGTH,
} from '../../lib/telegramBotEngine';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { Badge } from '../common/Badge';
import {
  Send,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  ShoppingBag,
  Terminal,
  FileCode,
  ShieldCheck,
  Lock,
  ArrowRight,
  StopCircle,
  Cpu,
  Radio,
} from 'lucide-react';

interface TelegramBotModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: AccountRecord | null;
  onSuccess?: () => void;
}

export const TelegramBotModal: React.FC<TelegramBotModalProps> = ({
  isOpen,
  onClose,
  account,
  onSuccess,
}) => {
  const { canViewSensitiveTokens, requestSensitiveAuthorization } = useAuth();
  const { showToast, refreshData } = useApp();

  const [state, setState] = useState<TelegramWorkflowState>('READY');
  const [logs, setLogs] = useState<TelegramStepLog[]>([]);
  const [report, setReport] = useState<TelegramWorkflowReport | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [authorized, setAuthorized] = useState<boolean>(false);
  const [runner, setRunner] = useState<TelegramBotWorkflowRunner | null>(null);

  // Execution mode: 'real' (Telethon MTProto on real Telegram account) vs 'sim' (Verification Engine)
  const [executionMode, setExecutionMode] = useState<'real' | 'sim'>('real');
  const [isCredConfigured, setIsCredConfigured] = useState<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (isOpen) {
      setState('READY');
      setLogs([]);
      setReport(null);
      setIsRunning(false);
      setAuthorized(false);
      setRunner(null);

      // Check credential status from server
      fetch('/api/telegram/status')
        .then(res => res.json())
        .then(data => {
          setIsCredConfigured(Boolean(data.configured));
          if (!data.configured) {
            setExecutionMode('sim');
          }
        })
        .catch(() => {
          setIsCredConfigured(false);
          setExecutionMode('sim');
        });
    }
  }, [isOpen, account]);

  if (!account) return null;

  const validation = validateSessionPayload(account.account_json);

  const handleStartWorkflow = async () => {
    if (!authorized) {
      const ok = await requestSensitiveAuthorization();
      if (!ok) {
        showToast('Operator authorization required before transmitting session payload to Telegram.', 'error');
        return;
      }
      setAuthorized(true);
    }

    if (!validation.isValid) {
      showToast(validation.error || 'Invalid session JSON', 'error');
      return;
    }

    setIsRunning(true);
    setReport(null);
    setLogs([]);
    setState('READY');

    // 1. REAL TELEGRAM AUTOMATION (Telethon via backend bridge)
    if (executionMode === 'real') {
      try {
        const controller = new AbortController();
        abortControllerRef.current = controller;

        const res = await fetch('/api/telegram/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account_id: account.id,
            mobile: account.phone_display,
            session_json: account.account_json,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`Server returned HTTP ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error('Response body stream not available');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.slice(5).trim();
            if (!dataStr) continue;

            try {
              const event = JSON.parse(dataStr);
              if (event.type === 'LOG') {
                setState(event.state as TelegramWorkflowState);
                setLogs(prev => [
                  ...prev,
                  {
                    state: event.state,
                    timestamp: event.timestamp || new Date().toISOString(),
                    message: event.message,
                    details: event.details,
                    isError: event.is_error,
                  },
                ]);
              } else if (event.type === 'REPORT') {
                setReport(event.report);
              } else if (event.type === 'RAW') {
                setLogs(prev => [
                  ...prev,
                  {
                    state: (state || 'DATA_EXTRACTED') as TelegramWorkflowState,
                    timestamp: new Date().toISOString(),
                    message: event.text,
                    isError: false,
                  },
                ]);
              } else if (event.type === 'DONE') {
                setIsRunning(false);
                refreshData();
                if (onSuccess) onSuccess();
                showToast('Telegram MTProto automation finished.', 'success');
              }
            } catch {}
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          showToast('Workflow aborted by operator', 'info');
        } else {
          showToast(`Automation error: ${err.message}`, 'error');
          setLogs(prev => [
            ...prev,
            {
              state: 'FAILED',
              timestamp: new Date().toISOString(),
              message: `Execution failed: ${err.message}`,
              isError: true,
            },
          ]);
        }
        setIsRunning(false);
      }
      return;
    }

    // 2. CLIENT VERIFICATION / SIMULATION ENGINE
    const workflowRunner = new TelegramBotWorkflowRunner(
      {
        bot_username: '@primes_meesho_bot',
        account_id: account.id,
        mobile_number: account.phone_display,
        session_json: account.account_json,
        authorized: true,
      },
      (newState, newLog) => {
        setState(newState);
        setLogs(prev => [...prev, newLog]);
      }
    );

    setRunner(workflowRunner);

    const result = await workflowRunner.run();
    setReport(result);
    setIsRunning(false);

    if (result.session_submission_status === 'SUCCESS' && result.orders_page_result === 'SUCCESS') {
      showToast(
        `Workflow complete: ${result.new_orders_count} new orders extracted & saved to Supabase`,
        'success'
      );
      refreshData();
      if (onSuccess) onSuccess();
    } else {
      showToast(`Workflow stopped: ${result.error_summary || 'Incomplete steps'}`, 'warning');
    }
  };

  const handleCancelWorkflow = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (runner) {
      runner.cancel();
    }
    setIsRunning(false);
    showToast('Workflow cancelled by operator', 'info');
  };

  const stateSteps: Array<{ key: TelegramWorkflowState; label: string }> = [
    { key: 'BOT_OPENED', label: '1. /start' },
    { key: 'SESSION_INPUT_REQUESTED', label: '2. Import JSON' },
    { key: 'JSON_SENT', label: '3. Paste Text' },
    { key: 'SAVE_CONFIRMED', label: '4. Confirmed' },
    { key: 'BOT_RESTARTED', label: '5. /start Again' },
    { key: 'SHOP_OPENED', label: '6. Open Shop' },
    { key: 'ORDERS_OPENED', label: '7. Orders' },
    { key: 'DATA_EXTRACTED', label: '8. Extract' },
    { key: 'DATA_SAVED', label: '9. Save DB' },
  ];

  const getStateIndex = (curr: TelegramWorkflowState) => {
    const order: TelegramWorkflowState[] = [
      'READY',
      'BOT_OPENED',
      'SESSION_INPUT_REQUESTED',
      'JSON_SENT',
      'SAVE_CONFIRMED',
      'BOT_RESTARTED',
      'SHOP_OPENED',
      'ORDERS_OPENED',
      'DATA_EXTRACTED',
      'DATA_SAVED',
    ];
    return order.indexOf(curr);
  };

  const currentIndex = getStateIndex(state);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Telegram Bot Session Importer & Order Extractor"
      subtitle={`Automated integration for @primes_meesho_bot · Account: ${account.phone_display}`}
      maxWidth="3xl"
    >
      <div className="space-y-6">
        {/* Execution Mode Selector */}
        <div className="flex items-center justify-between p-3 bg-slate-950/80 rounded-xl border border-slate-800">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-pink-400" />
            <span className="text-xs font-semibold text-slate-300">Automation Engine Mode:</span>
          </div>

          <div className="flex items-center bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => setExecutionMode('real')}
              className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                executionMode === 'real'
                  ? 'bg-pink-700 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>Real Telegram MTProto (Telethon)</span>
              {isCredConfigured && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
            </button>

            <button
              type="button"
              onClick={() => setExecutionMode('sim')}
              className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                executionMode === 'sim'
                  ? 'bg-pink-700 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Simulation & Verification Engine</span>
            </button>
          </div>
        </div>

        {/* State Machine Visual Progress Bar */}
        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-2.5">
            Workflow State Machine:
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {stateSteps.map((s, idx) => {
              const isPast = currentIndex > idx + 1;
              const isCurrent = state === s.key;
              return (
                <span
                  key={s.key}
                  className={`px-2 py-1 rounded text-[11px] font-mono transition-all border ${
                    isCurrent
                      ? 'bg-pink-600 text-white font-bold border-pink-400 animate-pulse'
                      : isPast
                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60'
                      : 'bg-slate-900 text-slate-500 border-slate-800'
                  }`}
                >
                  {s.label}
                </span>
              );
            })}
          </div>
        </div>

        {/* JSON Payload Validation Card */}
        <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileCode className="w-4 h-4 text-pink-400" />
              <span className="text-xs font-semibold text-slate-200">
                Session JSON Text Verification
              </span>
            </div>
            <span
              className={`font-mono text-xs ${
                validation.charCount <= TELEGRAM_MAX_MESSAGE_LENGTH
                  ? 'text-emerald-400 font-semibold'
                  : 'text-rose-400 font-bold'
              }`}
            >
              {validation.charCount} / {TELEGRAM_MAX_MESSAGE_LENGTH} characters
            </span>
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed">
            Rule: The session JSON must be sent as a single normal text message,{' '}
            <strong className="text-slate-200">never uploaded as a file or attachment</strong>.
            Length must strictly not exceed Telegram's 4,096 character limit.
          </p>

          {!validation.isValid && (
            <div className="p-2.5 bg-rose-950/50 border border-rose-800 text-rose-300 rounded text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{validation.error}</span>
            </div>
          )}

          {/* Authorization Checkbox */}
          <label className="flex items-center gap-2.5 pt-1 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={authorized}
              onChange={e => setAuthorized(e.target.checked)}
              disabled={isRunning}
              className="w-4 h-4 rounded border-slate-700 text-pink-600 focus:ring-pink-500 bg-slate-900"
            />
            <span className="text-xs text-slate-300 font-medium">
              I authorize transmitting this account session payload to @primes_meesho_bot.
            </span>
          </label>
        </div>

        {/* Live Terminal Stream of Bot Responses */}
        <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden shadow-inner">
          <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/60 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <Terminal className="w-3.5 h-3.5 text-pink-400" />
              <span>
                Live Execution Stream (@primes_meesho_bot · {executionMode === 'real' ? 'Telethon MTProto' : 'Simulation Engine'})
              </span>
            </div>
            {isRunning && (
              <span className="flex items-center gap-1.5 text-[11px] text-pink-400 font-mono">
                <span className="w-2 h-2 rounded-full bg-pink-500 animate-ping" />
                Active
              </span>
            )}
          </div>

          <div className="p-3.5 font-mono text-xs max-h-52 overflow-y-auto space-y-1.5 select-text">
            {logs.length === 0 ? (
              <p className="text-slate-600 italic">Ready. Click 'Start Telegram Workflow' to begin execution.</p>
            ) : (
              logs.map((log, idx) => (
                <div
                  key={idx}
                  className={`leading-relaxed ${
                    log.isError ? 'text-rose-400' : 'text-slate-300'
                  }`}
                >
                  <span className="text-slate-500 mr-2">[{log.timestamp.slice(11, 19)}]</span>
                  <span className="text-pink-400 font-bold mr-1.5">{log.state}:</span>
                  <span>{log.message}</span>
                  {log.details && (
                    <p className="text-slate-500 text-[11px] ml-16 mt-0.5">{log.details}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Step 6: Detailed Completion Report */}
        {report && (
          <div className="bg-slate-900 border border-slate-700/80 rounded-xl p-4 space-y-3 animate-in fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Workflow Completion Report
                </h4>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                {new Date(report.completed_at).toLocaleTimeString()}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                <span className="text-[11px] text-slate-500 block">Account Phone</span>
                <span className="font-mono font-semibold text-slate-200">{report.mobile_number}</span>
              </div>
              <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                <span className="text-[11px] text-slate-500 block">Session Paste Status</span>
                <span
                  className={`font-mono font-semibold ${
                    report.session_submission_status === 'SUCCESS' ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {report.session_submission_status}
                </span>
              </div>
              <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                <span className="text-[11px] text-slate-500 block">Saved Confirmation</span>
                <span
                  className={`font-mono font-semibold ${
                    report.saved_confirmation_detected ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {report.saved_confirmation_detected ? 'DETECTED' : 'NOT DETECTED'}
                </span>
              </div>
              <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                <span className="text-[11px] text-slate-500 block">Shop & Orders Access</span>
                <span className="font-mono font-semibold text-emerald-400">
                  {report.orders_page_result}
                </span>
              </div>
            </div>

            {/* Order Metrics Breakdown */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                <span className="text-[11px] text-slate-500 block">Total Extracted</span>
                <span className="text-base font-bold font-mono text-slate-100">
                  {report.total_orders_extracted}
                </span>
              </div>
              <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                <span className="text-[11px] text-emerald-400 block">New Orders Saved</span>
                <span className="text-base font-bold font-mono text-emerald-300">
                  {report.new_orders_count}
                </span>
              </div>
              <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                <span className="text-[11px] text-cyan-400 block">Orders Updated</span>
                <span className="text-base font-bold font-mono text-cyan-300">
                  {report.updated_orders_count}
                </span>
              </div>
              <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                <span className="text-[11px] text-slate-400 block">Duplicates Skipped</span>
                <span className="text-base font-bold font-mono text-slate-300">
                  {report.duplicate_orders_skipped}
                </span>
              </div>
            </div>

            {/* Extracted Orders Preview */}
            {report.extracted_orders.length > 0 && (
              <div className="mt-2 border-t border-slate-800 pt-2">
                <span className="text-[11px] font-semibold text-slate-400 block mb-1.5">
                  Extracted Orders Preview:
                </span>
                <div className="max-h-36 overflow-y-auto space-y-1">
                  {report.extracted_orders.map((ord, idx) => (
                    <div
                      key={idx}
                      className="p-2 bg-slate-950 rounded border border-slate-800/80 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-pink-400 font-semibold">{ord.external_order_id}</span>
                        <span className="text-slate-300 truncate max-w-xs">{ord.product_name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-100">₹{ord.order_amount.toFixed(2)}</span>
                        <Badge variant="success" size="sm">{ord.delivery_status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Actions Bar */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={isRunning}
            className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
          >
            Close
          </button>

          <div className="flex items-center gap-3">
            {isRunning ? (
              <button
                type="button"
                onClick={handleCancelWorkflow}
                className="flex items-center gap-1.5 px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white rounded-lg text-xs font-semibold shadow-md transition-colors cursor-pointer"
              >
                <StopCircle className="w-3.5 h-3.5" />
                <span>Stop Workflow</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleStartWorkflow}
                disabled={!authorized || !validation.isValid}
                className="flex items-center gap-1.5 px-5 py-2.5 bg-pink-700 hover:bg-pink-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-lg shadow-pink-950/50 transition-all cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>
                  Start {executionMode === 'real' ? 'Live Telegram Automation' : 'Simulated Workflow'}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};
