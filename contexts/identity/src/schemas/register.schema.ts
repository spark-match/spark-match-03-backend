import { z } from 'zod';

export const RegisterInputSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(8).max(100),
  fullName: z.string().min(2).max(200),
  age: z.number().int().min(13).max(120).optional(),
});

export type RegisterInput = z.infer<typeof RegisterInputSchema>;

export const RegisterOutputSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  fullName: z.string(),
  createdAt: z.string(),
  /**
   * Se devuelve para que la respuesta diga lo que acaba de pasar. Este endpoint
   * concedia rol de administrador y no lo mencionaba; ahora concede `student` y
   * tampoco lo decia. Un contrato que calla el privilegio que otorga es
   * exactamente como se sostuvo el fallo sin que nadie lo viera.
   */
  role: z.enum(['admin', 'student']),
});

export type RegisterOutput = z.infer<typeof RegisterOutputSchema>;
