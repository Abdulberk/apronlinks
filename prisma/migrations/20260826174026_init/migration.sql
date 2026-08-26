-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('FIXTURE', 'FR24');

-- CreateEnum
CREATE TYPE "FlightStatus" AS ENUM ('SCHEDULED', 'AIRBORNE', 'ARRIVED', 'CANCELLED', 'RESULT_UNKNOWN');

-- CreateEnum
CREATE TYPE "ChangeField" AS ENUM ('FLIGHT_NUMBER', 'AIRCRAFT_REGISTRATION');

-- CreateEnum
CREATE TYPE "IngestOutcome" AS ENUM ('CREATED', 'APPLIED', 'DUPLICATE', 'STALE', 'NO_CHANGE', 'REJECTED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'WARNING');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('UNREAD', 'ACKNOWLEDGED');

-- CreateTable
CREATE TABLE "Flight" (
    "id" UUID NOT NULL,
    "providerFlightId" VARCHAR(64) NOT NULL,
    "providerSource" "Provider" NOT NULL,
    "flightNumber" VARCHAR(16) NOT NULL,
    "aircraftRegistration" VARCHAR(16),
    "aircraftHex" VARCHAR(8),
    "aircraftType" VARCHAR(8),
    "flightDate" DATE NOT NULL,
    "origin" VARCHAR(8),
    "destination" VARCHAR(8),
    "scheduledDeparture" TIMESTAMPTZ(3),
    "status" "FlightStatus" NOT NULL DEFAULT 'SCHEDULED',
    "arrivedAt" TIMESTAMPTZ(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "sourceTimestamp" TIMESTAMPTZ(3) NOT NULL,
    "lastSyncedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastPolledAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextPollAt" TIMESTAMPTZ(3),
    "trackingActive" BOOLEAN NOT NULL DEFAULT true,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Flight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestEvent" (
    "id" UUID NOT NULL,
    "eventId" VARCHAR(128) NOT NULL,
    "providerFlightId" VARCHAR(64) NOT NULL,
    "payloadHash" VARCHAR(64) NOT NULL,
    "outcome" "IngestOutcome" NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightChange" (
    "id" UUID NOT NULL,
    "flightId" UUID NOT NULL,
    "field" "ChangeField" NOT NULL,
    "fromRevision" INTEGER NOT NULL,
    "toRevision" INTEGER NOT NULL,
    "oldValue" VARCHAR(32),
    "newValue" VARCHAR(32) NOT NULL,
    "detectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlightChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" UUID NOT NULL,
    "flightId" UUID NOT NULL,
    "changeId" UUID NOT NULL,
    "severity" "Severity" NOT NULL DEFAULT 'INFO',
    "status" "AlertStatus" NOT NULL DEFAULT 'UNREAD',
    "title" VARCHAR(64) NOT NULL,
    "body" VARCHAR(256) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Flight_trackingActive_nextPollAt_idx" ON "Flight"("trackingActive", "nextPollAt");

-- CreateIndex
CREATE UNIQUE INDEX "Flight_providerSource_providerFlightId_key" ON "Flight"("providerSource", "providerFlightId");

-- CreateIndex
CREATE UNIQUE INDEX "IngestEvent_eventId_key" ON "IngestEvent"("eventId");

-- CreateIndex
CREATE INDEX "IngestEvent_receivedAt_idx" ON "IngestEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "FlightChange_flightId_detectedAt_idx" ON "FlightChange"("flightId", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FlightChange_flightId_field_fromRevision_key" ON "FlightChange"("flightId", "field", "fromRevision");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_changeId_key" ON "Alert"("changeId");

-- CreateIndex
CREATE INDEX "Alert_status_createdAt_idx" ON "Alert"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Alert_flightId_createdAt_idx" ON "Alert"("flightId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "FlightChange" ADD CONSTRAINT "FlightChange_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_flightId_fkey" FOREIGN KEY ("flightId") REFERENCES "Flight"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "FlightChange"("id") ON DELETE CASCADE ON UPDATE CASCADE;
