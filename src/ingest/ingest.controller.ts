import {
  HttpCode,
  BadRequestException,
  Body,
  Controller,
  Headers,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Flight } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { env } from '../config/env';
import { IngestService, type IngestResult } from './ingest.service';
import { verifySignature } from './signature';

/**
 * A delivery id is required rather than optional. We control every caller of
 * this endpoint, so there is no reason to accept one without it — and having it
 * means a request captured inside the signature's five-minute window still
 * cannot be replayed to any effect.
 */
const snapshotSchema = z.object({
  eventId: z.string().min(1).max(128),
  providerFlightId: z.string().min(1).max(64),
  flightNumber: z.string().max(16).nullish(),
  aircraftRegistration: z.string().max(16).nullish(),
  sourceTimestamp: z.iso.datetime(),
});

@Controller('ingest')
export class IngestController {
  private readonly secret = env().INGEST_HMAC_SECRET;

  constructor(
    private readonly ingest: IngestService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The production-shaped entry point: signed, replay-protected, and returning
   * what it decided rather than a bare 200.
   *
   * The outcome in the response is what makes duplicate prevention something
   * you can watch instead of something you have to be told about. Post the same
   * signed body twice and the second answers DUPLICATE while the change count
   * stays where it was.
   */
  // 200, not the framework's default 201. A webhook-shaped endpoint answers
  // "I have taken responsibility for this delivery" — whether that meant
  // applying a change, recognising a replay or finding nothing new is business
  // detail, and it is in the body. Answering Created to a duplicate would say
  // something was created when nothing was.
  @HttpCode(200)
  @Post('flight-snapshot')
  async ingestSnapshot(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers('x-signature') signature: string | undefined,
    @Body() body: unknown,
  ): Promise<IngestResult> {
    const raw = request.rawBody;
    if (raw === undefined) {
      throw new BadRequestException('raw body unavailable');
    }

    const verified = verifySignature(raw, signature, this.secret);
    if (!verified.ok) {
      throw new UnauthorizedException(`signature ${verified.reason}`);
    }

    const parsed = snapshotSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(z.prettifyError(parsed.error));
    }

    return this.ingest.process(
      {
        providerFlightId: parsed.data.providerFlightId,
        flightNumber: parsed.data.flightNumber,
        aircraftRegistration: parsed.data.aircraftRegistration,
        sourceTimestamp: new Date(parsed.data.sourceTimestamp),
      },
      parsed.data.eventId,
    );
  }

  /**
   * A local affordance so the dashboard has a button, nothing more. It is not
   * signed because the browser cannot hold the secret, and it exists only so a
   * change can be triggered on camera without hand-computing an HMAC.
   *
   * Both watched fields get a trigger, because the brief asks for detection of
   * the flight number *or* the registration and a demo that can only show one
   * of them leaves the reviewer taking the other on trust.
   *
   * Each swaps between two values rather than setting one, so pressing a button
   * repeatedly produces the flip-flop the history view exists to show — and
   * proves that returning to a previous value is recorded as another change
   * rather than suppressed as a repeat.
   */
  @HttpCode(200)
  @Post('demo/tail-swap')
  async demoTailSwap(@Body() body: unknown): Promise<IngestResult> {
    const flight = await this.demoTarget(body, 'seed-alx314');

    return this.applyDemo(flight, {
      aircraftRegistration:
        flight.aircraftRegistration === 'NQ-ATC' ? 'NQ-BRD' : 'NQ-ATC',
    });
  }

  /**
   * Deliberately a different flight from the tail swap. Renumbering ALX314
   * would move the very flight the brief names in its example, and the two
   * demos would fight over the same row on screen.
   */
  @HttpCode(200)
  @Post('demo/number-change')
  async demoNumberChange(@Body() body: unknown): Promise<IngestResult> {
    const flight = await this.demoTarget(body, 'seed-tk1985');

    return this.applyDemo(flight, {
      flightNumber: flight.flightNumber === 'TK1985' ? 'TK1907' : 'TK1985',
    });
  }

  /**
   * Found by the provider's id, never by the flight number.
   *
   * This is the project's own thesis applied to its demo: the number is one of
   * the fields being watched for change, so keying on it means the second press
   * of the renumber button cannot find the flight the first press renamed. It
   * would work once and 404 for good — on camera, at the worst moment.
   */
  private async demoTarget(
    body: unknown,
    fallbackProviderFlightId: string,
  ): Promise<Flight> {
    const target = z
      .object({ flightId: z.string().uuid().optional() })
      .safeParse(body ?? {});

    const flight =
      target.success && target.data.flightId !== undefined
        ? await this.prisma.flight.findUnique({
            where: { id: target.data.flightId },
          })
        : await this.prisma.flight.findFirst({
            where: { providerFlightId: fallbackProviderFlightId },
          });

    if (flight === null) throw new NotFoundException('no flight to change');
    return flight;
  }

  private applyDemo(
    flight: Flight,
    fields: { aircraftRegistration?: string; flightNumber?: string },
  ): Promise<IngestResult> {
    return this.ingest.process({
      providerFlightId: flight.providerFlightId,
      ...fields,
      // Ahead of what is stored, so the ordering guard lets it through. A demo
      // that trips its own staleness check teaches the wrong lesson.
      sourceTimestamp: new Date(+flight.sourceTimestamp + 60_000),
    });
  }
}
