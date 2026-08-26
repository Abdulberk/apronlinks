import type { DetectedChange } from './types';

/**
 * Context needed to name a flight in an alert. It deliberately carries the
 * fields that did NOT change, because naming a flight by the value that just
 * changed is ambiguous to whoever reads the alert at 03:00.
 */
export interface AlertContext {
  flightNumber: string;
  origin: string | null;
  destination: string | null;
  /** YYYY-MM-DD, local departure date at the origin. */
  flightDate: string;
}

export interface AlertMessage {
  title: string;
  body: string;
}

/**
 * Reproduces the wording from the brief exactly:
 *
 *   Aircraft Change Detected
 *   Flight ALX314: Aircraft registration changed from NQ-ATC to NQ-BRD.
 *
 * Values render exactly as the provider sent them, never normalized: the
 * operator will cross-check these strings against other systems, so they have
 * to match what those systems display.
 *
 * The brief only supplies the registration example. For a flight-number change
 * we name the flight by the number it carried AT DETECTION TIME, so the
 * operator can correlate it with the feed they last saw, and the body then
 * shows the move explicitly.
 */
export function formatAlert(
  change: DetectedChange,
  context: AlertContext,
): AlertMessage {
  if (change.field === 'AIRCRAFT_REGISTRATION') {
    return {
      title: 'Aircraft Change Detected',
      body:
        `Flight ${context.flightNumber}: Aircraft registration changed ` +
        `from ${change.oldValue} to ${change.newValue}.`,
    };
  }

  return {
    title: 'Flight Number Change Detected',
    body:
      `Flight ${change.oldValue}: Flight number changed ` +
      `from ${change.oldValue} to ${change.newValue}.`,
  };
}
