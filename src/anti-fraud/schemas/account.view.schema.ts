import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AccountViewDocument = AccountView & Document;

@Schema({
  collection: 'account_views',
  timestamps: true,
})
export class AccountView {
  @Prop({ required: true, unique: true, index: true })
  iban: string;

  @Prop()
  status: string; // 'active', 'blocked', etc.

  updatedAt?: Date;
}

export const AccountViewSchema = SchemaFactory.createForClass(AccountView);
