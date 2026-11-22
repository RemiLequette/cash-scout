export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role?: string | null;
}

export interface AppEnv {
  Variables: { user: SessionUser };
}
