import jwt from "jsonwebtoken";

/** Issues and checks signed session tokens. */
export class TokenService {
  constructor(private readonly secret: string) {}

  /**
   * Signs a token for a user.
   * @param subject user id stored in the `sub` claim
   */
  issue(subject: string, ttlSeconds = 3600): string {
    return jwt.sign({ sub: subject }, this.secret, { expiresIn: ttlSeconds });
  }

  /** Returns false instead of throwing so callers can map it to a 401. */
  verify(token: string): boolean {
    try {
      this.decode(token);
      return true;
    } catch {
      return false;
    }
  }

  private decode(token: string) {
    return jwt.verify(token.replace(/^Bearer /, ""), this.secret);
  }

  static fromEnv = (): TokenService => new TokenService(process.env.JWT_SECRET ?? "");
}
