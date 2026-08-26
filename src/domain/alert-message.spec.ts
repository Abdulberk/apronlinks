import { formatAlert, type AlertContext } from './alert-message';
import type { DetectedChange } from './types';

const context: AlertContext = {
  flightNumber: 'ALX314',
  origin: 'EGLL',
  destination: 'KSEA',
  flightDate: '2026-08-26',
};

describe('formatAlert', () => {
  it('reproduces the wording from the brief exactly', () => {
    const change: DetectedChange = {
      field: 'AIRCRAFT_REGISTRATION',
      oldValue: 'NQ-ATC',
      newValue: 'NQ-BRD',
      alertable: true,
    };

    expect(formatAlert(change, context)).toEqual({
      title: 'Aircraft Change Detected',
      body: 'Flight ALX314: Aircraft registration changed from NQ-ATC to NQ-BRD.',
    });
  });

  it('names a flight-number change by the number carried at detection time', () => {
    const change: DetectedChange = {
      field: 'FLIGHT_NUMBER',
      oldValue: 'ALX314',
      newValue: 'ALX320',
      alertable: true,
    };

    expect(formatAlert(change, context)).toEqual({
      title: 'Flight Number Change Detected',
      body: 'Flight ALX314: Flight number changed from ALX314 to ALX320.',
    });
  });

  it('renders provider formatting verbatim rather than the normalized form', () => {
    const change: DetectedChange = {
      field: 'AIRCRAFT_REGISTRATION',
      oldValue: 'NQ-ATC',
      newValue: 'nq-brd',
      alertable: true,
    };

    expect(formatAlert(change, context).body).toContain('to nq-brd.');
  });
});
