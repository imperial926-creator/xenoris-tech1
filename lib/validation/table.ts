import { z } from 'zod';

export const TABLE_STATUSES = [
  'AVAILABLE',
  'RESERVED',
  'OCCUPIED',
  'WAITING',
  'CLEANING',
  'OUT_OF_SERVICE',
] as const;

export const createTableSectionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
});
export type CreateTableSectionInput = z.infer<typeof createTableSectionSchema>;

export const updateTableSectionSchema = createTableSectionSchema.partial().extend({
  active: z.boolean().optional(),
});
export type UpdateTableSectionInput = z.infer<typeof updateTableSectionSchema>;

export const createTableSchema = z.object({
  sectionId: z.string().trim().min(1).optional(),
  tableNumber: z.string().trim().min(1).max(20),
  capacity: z.number().int().min(1).max(50),
});
export type CreateTableInput = z.infer<typeof createTableSchema>;

export const updateTableSchema = createTableSchema.partial().extend({
  active: z.boolean().optional(),
});
export type UpdateTableInput = z.infer<typeof updateTableSchema>;

export const updateTableStatusSchema = z.object({
  status: z.enum(TABLE_STATUSES),
  note: z.string().trim().max(300).optional(),
});
export type UpdateTableStatusInput = z.infer<typeof updateTableStatusSchema>;
