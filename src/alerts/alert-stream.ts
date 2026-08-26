import { Injectable, BeforeApplicationShutdown } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

/**
 * In-process fan-out for newly raised alerts.
 *
 * A Subject rather than @nestjs/event-emitter: there is one consumer, so a
 * string-keyed event bus would add a dependency and a layer of indirection to
 * express what a typed method call already says. It is also easier to describe
 * out loud — ingest pushes here, the SSE route reads from here.
 *
 * Deliberately at-most-once. A subscriber that is not connected at the moment
 * of publication misses the push and catches up on its next fetch. That is
 * acceptable because the dashboard refetches whenever the stream reconnects.
 * It would not be acceptable for an email, and the honest place to say so is
 * the README rather than a comment claiming a guarantee this does not give.
 */
@Injectable()
export class AlertStream implements BeforeApplicationShutdown {
  private readonly subject = new Subject<string>();

  /** Emits the flight id that just raised one or more alerts. */
  publish(flightId: string): void {
    this.subject.next(flightId);
  }

  observe(): Observable<string> {
    return this.subject.asObservable();
  }

  /**
   * Fastify treats an open SSE response as still in flight, so without
   * completing the subject here app.close() waits on connections that by design
   * never end, and the platform eventually SIGKILLs instead.
   */
  beforeApplicationShutdown(): void {
    this.subject.complete();
  }
}
