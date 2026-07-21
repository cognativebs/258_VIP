import { z } from "zod";
import { BaseRecordSchema, UuidSchema } from "./base.js";

export const ToolCodeSchema = z.enum(["iqvault", "vaultos", "orchastr8"]);
export type ToolCode = z.infer<typeof ToolCodeSchema>;

export const ToolSchema = BaseRecordSchema.extend({
  code: ToolCodeSchema,
  displayName: z.string().min(1),
});
export type Tool = z.infer<typeof ToolSchema>;

export const ToolUserSchema = BaseRecordSchema.extend({
  toolId: UuidSchema,
  handle: z.string().min(1),
  authRef: z.string().optional(),
});
export type ToolUser = z.infer<typeof ToolUserSchema>;

export const AccountLinkStatusSchema = z.enum(["pending", "active", "revoked"]);
export const AccountLinkSchema = BaseRecordSchema.extend({
  fromUserId: UuidSchema,
  toUserId: UuidSchema,
  status: AccountLinkStatusSchema,
});
export type AccountLink = z.infer<typeof AccountLinkSchema>;

export const TenantTypeSchema = z.enum(["personal", "store"]);
export const TenantSchema = BaseRecordSchema.extend({
  type: TenantTypeSchema,
  displayName: z.string().min(1),
});
export type Tenant = z.infer<typeof TenantSchema>;
