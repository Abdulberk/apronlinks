import { Module } from '@nestjs/common';
import { FlightsController } from './flights.controller';

@Module({ controllers: [FlightsController] })
export class FlightsModule {}
