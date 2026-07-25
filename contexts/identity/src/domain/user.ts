export interface User {
  id: string;
  email: string;
  fullName: string;
  passwordHash: string;
  age: number | null;
  role: UserRole;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type UserRole = 'admin';

export const USER_ROLES: readonly UserRole[] = ['admin'];

export type CreateUserInput = {
  email: string;
  fullName: string;
  passwordHash: string;
  age?: number;
};

export type PublicUser = Omit<User, 'passwordHash'>;
