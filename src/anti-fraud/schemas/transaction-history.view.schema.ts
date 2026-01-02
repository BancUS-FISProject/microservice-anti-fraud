import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TransactionHistoryViewDocument = TransactionHistoryView & Document;

// Sub-esquema para los ítems de transacción (para que Mongo sepa la estructura)
@Schema({ _id: false }) // No necesitamos _id para cada sub-item
class TransactionItemView {
  @Prop() id: string;
  @Prop() currency: string;
  @Prop() date: string;
  @Prop() quantity: number;
  @Prop() sender: string;
  @Prop() receiver: string;
  @Prop() status: string;
}
const TransactionItemSchema = SchemaFactory.createForClass(TransactionItemView);

@Schema({
  collection: 'transaction_history_view', // Nombre de la colección en Mongo
  timestamps: true, // updatedAt nos servirá para saber la frescura de los datos
})
export class TransactionHistoryView {
  @Prop({ required: true, unique: true, index: true })
  origin: string; // El IBAN o identificador de la cuenta

  @Prop({ type: [TransactionItemSchema], default: [] })
  transactions: TransactionItemView[]; // La copia de los datos
}

export const TransactionHistoryViewSchema = SchemaFactory.createForClass(
  TransactionHistoryView,
);
