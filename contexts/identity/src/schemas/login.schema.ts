import { z } from 'zod';

export const LoginInputSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(8).max(100),
});

export type LoginInput = z.infer<typeof LoginInputSchema>;

export const LoginOutputSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  user: z.object({
    id: z.uuid(),
    email: z.email(),
    fullName: z.string(),
    /**
     * El rol viaja aqui porque el cliente lo necesita para decidir que enseña,
     * y hasta ahora no tenia de donde sacarlo: esta proyeccion traia solo id,
     * email y fullName, asi que el frontend guardaba un usuario sin rol y
     * mostraba el panel de administracion a cualquiera.
     *
     * Va en el cuerpo y no se deja que el cliente lo lea del JWT: el token es
     * opaco por contrato, y decodificarlo en el navegador convierte un detalle
     * de implementacion del backend en algo de lo que depende la interfaz.
     *
     * Esto NO es el control de acceso. Quien decide es el servidor, con los 403
     * de user-service y audit-service. Esto solo evita enseñar puertas que al
     * abrirlas dan 403.
     */
    role: z.enum(['admin', 'student']),
  }),
});

export type LoginOutput = z.infer<typeof LoginOutputSchema>;
