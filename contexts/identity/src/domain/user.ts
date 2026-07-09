export interface User {
  id: string;
  email: string;
  fullName: string;
  passwordHash: string;
  age: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateUserInput = {
  email: string;
  fullName: string;
  passwordHash: string;
  age?: number;
};

export type PublicUser = Omit<User, 'passwordHash'>;
