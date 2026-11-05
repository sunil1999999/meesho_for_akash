import { describe, it, expect } from 'vitest';
import {
  extractTrackingId,
  getTrackingStatus,
  isTrackingAssigned,
} from '../lib/trackingExtractor';

describe('Tracking ID Extraction and Utility Tests', () => {
  describe('extractTrackingId from primitives and text', () => {
    it('extracts direct alphanumeric tracking codes', () => {
      expect(extractTrackingId('FMPC002910823')).toBe('FMPC002910823');
      expect(extractTrackingId('SF10928192')).toBe('SF10928192');
      expect(extractTrackingId('AWB991204812')).toBe('AWB991204812');
      expect(extractTrackingId('14210982312')).toBe('14210982312');
      expect(extractTrackingId(14210982312)).toBe('14210982312');
    });

    it('extracts tracking ID from labelled text', () => {
      expect(extractTrackingId('Shipment Tracking ID: FMPC9981204812')).toBe('FMPC9981204812');
      expect(extractTrackingId('Tracking ID - SF10928192')).toBe('SF10928192');
      expect(extractTrackingId('AWB No: DEL-88120481')).toBe('DEL-88120481');
      expect(extractTrackingId('Waybill # WB-991283')).toBe('WB-991283');
      expect(extractTrackingId('Courier Ref: XBEES123456')).toBe('XBEES123456');
    });

    it('extracts known courier patterns embedded inside notes sentences', () => {
      const sentence = 'Package dispatched via Ekart with tracking FMPC001928392 arriving on Thursday.';
      expect(extractTrackingId(sentence)).toBe('FMPC001928392');

      const speedPost = 'Sent through Speed Post article EM123456789IN on Monday.';
      expect(extractTrackingId(speedPost)).toBe('EM123456789IN');
    });

    it('returns undefined for placeholders, invalid formats, or empty strings', () => {
      expect(extractTrackingId('')).toBeUndefined();
      expect(extractTrackingId('   ')).toBeUndefined();
      expect(extractTrackingId(null)).toBeUndefined();
      expect(extractTrackingId(undefined)).toBeUndefined();
      expect(extractTrackingId('none')).toBeUndefined();
      expect(extractTrackingId('N/A')).toBeUndefined();
      expect(extractTrackingId('not assigned')).toBeUndefined();
      expect(extractTrackingId('pending')).toBeUndefined();
      expect(extractTrackingId('-')).toBeUndefined();
      expect(extractTrackingId('--')).toBeUndefined();
      expect(extractTrackingId('Order placed and confirmed')).toBeUndefined();
    });
  });

  describe('extractTrackingId from object payloads and API responses', () => {
    it('extracts from direct object keys', () => {
      expect(extractTrackingId({ tracking_id: 'FMPC1029102' })).toBe('FMPC1029102');
      expect(extractTrackingId({ awb: 'DELHIVERY99120' })).toBe('DELHIVERY99120');
      expect(extractTrackingId({ waybill_number: 'WB-8812903' })).toBe('WB-8812903');
    });

    it('extracts from nested shipment / delivery structures', () => {
      const apiPayload = {
        order_num: '109281',
        product: { name: 'Kurti' },
        shipment: {
          status: 'shipped',
          awb: 'AWB-55443322',
        },
      };
      expect(extractTrackingId(apiPayload)).toBe('AWB-55443322');

      const deliveryPayload = {
        delivery_details: {
          courier_tracking_id: 'SF-1029381',
        },
      };
      expect(extractTrackingId(deliveryPayload)).toBe('SF-1029381');
    });

    it('extracts from object text fields (notes / status_text / raw_message_snippet)', () => {
      const orderData = {
        notes: 'Tracking ID: FMPC9981204812 updated by hub',
      };
      expect(extractTrackingId(orderData)).toBe('FMPC9981204812');
    });
  });

  describe('getTrackingStatus and isTrackingAssigned', () => {
    it('returns Tracking ID Assigned when valid ID is present', () => {
      expect(getTrackingStatus('FMPC002910823')).toBe('Tracking ID Assigned');
      expect(isTrackingAssigned('FMPC002910823')).toBe(true);
    });

    it('returns Not Assigned when ID is missing or placeholder', () => {
      expect(getTrackingStatus(undefined)).toBe('Not Assigned');
      expect(getTrackingStatus(null)).toBe('Not Assigned');
      expect(getTrackingStatus('')).toBe('Not Assigned');
      expect(getTrackingStatus('N/A')).toBe('Not Assigned');
      expect(getTrackingStatus('none')).toBe('Not Assigned');
      expect(isTrackingAssigned(undefined)).toBe(false);
      expect(isTrackingAssigned('')).toBe(false);
    });
  });
});
