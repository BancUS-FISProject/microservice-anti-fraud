import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type FraudAlertDocument = FraudAlert & Document;

@Schema({
  collection: 'fraudalerts',
  timestamps: {
    createdAt: 'reportDate',
    updatedAt: 'reportUpdateDate',
  },
})
export class FraudAlert {
  @Prop({ required: true })
  origin: string;

  @Prop({ required: true })
  destination: string;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  transactionDate: Date;

  @Prop({ required: true })
  reason: string;

  @Prop({ default: 'PENDING' })
  status: 'PENDING' | 'REVIEWED' | 'CONFIRMED' | 'FALSE_POSITIVE';

  reportCreationDate?: Date; // Para que el lindt no de error.
  reportUpdateDate?: Date;
}

export const FraudAlertSchema = SchemaFactory.createForClass(FraudAlert);

// Un usuario solo puede tener 1 alerta por transacción
FraudAlertSchema.index(
  { origin: 1, destination: 1, amount:1, transactionDate: 1 },
  { unique: true },
);
