import {
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
import { PrismaService } from '../prisma/prisma.service';
import { validateEnv } from '../config/env';
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
  private readonly secret = validateEnv(process.env).INGEST_HMAC_SECRET;

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
   * It swaps the flight's registration to whichever of the two demo values it
   * is not currently showing, so pressing it repeatedly produces the flip-flop
   * the history view is there to show.
   */
  @Post('demo/tail-swap')
  async demoTailSwap(@Body() body: unknown): Promise<IngestResult> {
    const target = z
      .object({ flightId: z.string().uuid().optional() })
      .safeParse(body ?? {});

    const flight =
      target.success && target.data.flightId !== undefined
        ? await this.prisma.flight.findUnique({
            where: { id: target.data.flightId },
          })
        : await this.prisma.flight.findFirst({
            where: { flightNumber: 'ALX314' },
          });

    if (flight === null) throw new NotFoundException('no flight to swap');

    const swapped =
      flight.aircraftRegistration === 'NQ-ATC' ? 'NQ-BRD' : 'NQ-ATC';

    return this.ingest.process({
      providerFlightId: flight.providerFlightId,
      aircraftRegistration: swapped,
      // Ahead of what is stored, so the ordering guard lets it through. A demo
      // that trips its own staleness check teaches the wrong lesson.
      sourceTimestamp: new Date(+flight.sourceTimestamp + 60_000),
    });
  }
}
