/**
 * Zod validators for auth endpoints
 */

import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email("Email tidak valid").max(255).toLowerCase().trim(),
  password: z.string().min(12, "Password minimal 12 karakter").max(128),
  name: z.string().min(1).max(100).optional(),
});

export const loginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1).max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
