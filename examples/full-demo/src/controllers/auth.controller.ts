import {
  Controller, Get, Post,
  Status, StatusCode,
  Validate, Validator,
} from '@velocity/framework';
import type { VelocityRequest, VelocityResponse } from '@velocity/framework';
import { velo } from '../../velo';
import * as Joi from 'joi';

const loginSchema = Validator.createSchema({
  username: Joi.string().required(),
  password: Joi.string().min(4).required(),
});

// Hardcoded users for demo — in production this would hit a database
const DEMO_USERS: Record<string, { password: string; role: string }> = {
  admin: { password: 'admin123', role: 'admin' },
  user:  { password: 'user1234', role: 'user' },
};

@Controller('/auth')
class AuthController {
  /**
   * POST /api/auth/login
   * Sets a signed session cookie on successful login.
   *
   * Demonstrates:
   *   - Typed body injection (body param)
   *   - res.setCookie with signed: true
   *   - @Validate for input validation
   *   - @Status for explicit status code
   */
  @Post('/login')
  @Validate(loginSchema)
  @Status(StatusCode.OK)
  login(body: { username: string; password: string }, res: VelocityResponse): { message: string; user: string; role: string } | void {
    const entry = DEMO_USERS[body.username];
    if (!entry || entry.password !== body.password) {
      res.status(StatusCode.Unauthorized).json({ error: 'Invalid credentials' });
      return;
    }

    // Set a signed, httpOnly session cookie — value is "username:role"
    res.setCookie('session', `${body.username}:${entry.role}`, {
      signed: true,
      httpOnly: true,
      path: '/',
      maxAge: 3600, // 1 hour
      sameSite: 'Lax',
    });

    return { message: 'Logged in', user: body.username, role: entry.role };
  }

  /**
   * POST /api/auth/logout
   * Clears the session cookie.
   *
   * Demonstrates:
   *   - res.clearCookie
   */
  @Post('/logout')
  @Status(StatusCode.OK)
  logout(_req: VelocityRequest, res: VelocityResponse): { message: string } {
    res.clearCookie('session', { path: '/' });
    return { message: 'Logged out' };
  }

  /**
   * GET /api/auth/me
   * Returns the current user from the signed session cookie.
   *
   * Demonstrates:
   *   - signedCookies injection (reads verified cookie)
   *   - Cookie-based authentication without Authorization header
   */
  @Get('/me')
  me(signedCookies: Record<string, string | false>, res: VelocityResponse): { user: string; role: string } | void {
    const session = signedCookies?.session;
    if (!session || session === false) {
      res.status(StatusCode.Unauthorized).json({ error: 'Not logged in — no valid session cookie' });
      return;
    }

    const [user, role] = (session as string).split(':');
    return { user, role };
  }
}

velo.register(AuthController);
