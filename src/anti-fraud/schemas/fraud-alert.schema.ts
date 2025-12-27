import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type FraudAlertDocument = FraudAlert & Document;

@Schema({
  collection: 'fraudalerts',
  timestamps: true,
})
export class FraudAlert {
  @Prop({ required: true })
  origin: string;

  @Prop({ required: true })
  destination: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  reason: string; // Descripción del problema

  @Prop({ default: 'PENDING' })
  status: 'PENDING' | 'REVIEWED' | 'CONFIRMED' | 'FALSE_POSITIVE';

  createdAt?: Date; // Para que el lindt no de error.
}

export const FraudAlertSchema = SchemaFactory.createForClass(FraudAlert);

// Un usuario solo puede tener 1 alerta por transacción
FraudAlertSchema.index({ origin: 1, destination: 1, amount:1 }, { unique: true });
