'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API, listAlerts, listFlights, type Alert, type Flight } from '@/lib/api';

export type Connection = 'connecting' | 'live' | 'polling';

/**
 * Keeps the screen current two ways at once, which is not redundancy.
 *
 * The stream carries a nudge rather than the payload and is at-most-once by
 * design, so a push that arrives while nothing is listening is simply lost. The
 * slow poll underneath is what guarantees the screen is right anyway — it turns
 * a missed push into a few seconds of delay instead of a missing alert.
 */
export function useLiveData(pollMs = 5000) {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [unread, setUnread] = useState(0);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Guards against a slow response from an earlier refresh landing after a
  // newer one and putting stale rows back on screen.
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++generation.current;

    try {
      const [f, a] = await Promise.all([listFlights(), listAlerts()]);
      if (mine !== generation.current) return;

      setFlights(f.flights);
      setAlerts(a.alerts);
      setUnread(a.unread);
      setError(null);
    } catch (cause) {
      if (mine !== generation.current) return;
      setError(cause instanceof Error ? cause.message : 'the service is unreachable');
    } finally {
      if (mine === generation.current) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // refresh() is async, so this effect's body sets no state — the rule cannot
    // see past the await. Fetching once on mount is the point of subscribing.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();

    const stream = new EventSource(`${API}/alerts/stream`);
    stream.onopen = () => setConnection('live');
    stream.onerror = () => setConnection('polling');
    stream.onmessage = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as { type: string };
      if (payload.type === 'alert') void refresh();
    };

    const timer = setInterval(() => void refresh(), pollMs);

    return () => {
      stream.close();
      clearInterval(timer);
    };
  }, [refresh, pollMs]);

  return { flights, alerts, unread, connection, error, loaded, refresh };
}
