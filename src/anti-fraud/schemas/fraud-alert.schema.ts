import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type FraudAlertDocument = FraudAlert & Document;

@Schema({ timestamps: true })
export class FraudAlert {
  @Prop({ required: true, index: true })
  userId: number;

  @Prop({ required: true })
  transactionId: number;

  @Prop({ default: 'SYSTEM_DETECTED' })
  source: string; // SYSTEM_DETECTED o USER_REPORTED

  @Prop({ required: true })
  type: string; // Ej: SUSPICIOUS_ACCOUNT, HIGH_VELOCITY

  @Prop({ required: true })
  reason: string; // Descripción del problema

  @Prop({ default: 'PENDING' })
  status: 'PENDING' | 'REVIEWED' | 'CONFIRMED' | 'FALSE_POSITIVE';
}

export const FraudAlertSchema = SchemaFactory.createForClass(FraudAlert);

// Un usuario solo puede tener 1 alerta por transacción
FraudAlertSchema.index({ userId: 1, transactionId: 1 }, { unique: true });