/**
 * Where to reach the proxy server and, optionally, how to authenticate.
 */
export type Credentials = {
  username?: string;
  password?: string;
  host: string;
  port: number;
};

export function hasAuth(
  credentials: Credentials
): credentials is Credentials & { username: string; password: string } {
  return (
    credentials.username !== undefined && credentials.password !== undefined
  );
}
